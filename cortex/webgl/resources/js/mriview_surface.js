var mriview = (function(module) {
    var flatscale = 0.25;

    module.Surface = function(viewer, ctminfo) {
        this.viewer = viewer;
        this.loaded = $.Deferred();
        this.object = new THREE.Object3D();
        this.viewer.scene.add(this.object);

        this.meshes = {};
        this.pivot = {};
        this.volume = 0;
        this._pivot = 0;
        this.rotation = [ 0, 0, 200 ]; //azimuth, altitude, radius

        this.uniforms = THREE.UniformsUtils.merge( [
            THREE.UniformsLib[ "lights" ],
            {
                diffuse:    { type:'v3', value:new THREE.Vector3( .8,.8,.8 )},
                specular:   { type:'v3', value:new THREE.Vector3( 1,1,1 )},
                emissive:   { type:'v3', value:new THREE.Vector3( .2,.2,.2 )},
                shininess:  { type:'f',  value:500},
                specularStrength:{ type:'f',  value:1},

                thickmix:   { type:'f',  value:0.5},
                surfmix:    { type:'f',  value:0},

                //hatch:      { type:'t',  value:0, texture: module.makeHatch() },
                //hatchrep:   { type:'v2', value:new THREE.Vector2(108, 40) },
                hatchAlpha: { type:'f', value:1.},
                hatchColor: { type:'v3', value:new THREE.Vector3( 0,0,0 )},
                overlay:    { type:'t', value:this.blanktex },
                curvAlpha:  { type:'f', value:1.},
                curvScale:  { type:'f', value:.5},
                curvLim:    { type:'f', value:.2},
            }
        ]);

        var loader = new THREE.CTMLoader(false);
        loader.loadParts( ctminfo, function( geometries, materials, json ) {
            geometries[0].computeBoundingBox();
            geometries[1].computeBoundingBox();

            this.flatlims = json.flatlims;
            this.flatoff = [
                Math.max(
                    Math.abs(geometries[0].boundingBox.min.x),
                    Math.abs(geometries[1].boundingBox.max.x)
                ) / 3, Math.min(
                    geometries[0].boundingBox.min.y, 
                    geometries[1].boundingBox.min.y
                )];

            this.names = json.names;
            var gb0 = geometries[0].boundingBox, gb1 = geometries[1].boundingBox;
            var center = [
                ((gb1.max.x - gb0.min.x) / 2) + gb0.min.x,
                (Math.max(gb0.max.y, gb1.max.y) - Math.min(gb0.min.y, gb1.min.y)) / 2 + Math.min(gb0.min.y, gb1.min.y),
                (Math.max(gb0.max.z, gb1.max.z) - Math.min(gb0.min.z, gb1.min.z)) / 2 + Math.min(gb0.min.z, gb1.min.z),
            ];
            this.center = center;
            this.object.position.set(0, -center[1], -center[2]);

            var names = {left:0, right:1};
            var posdata = {left:[], right:[]};
            for (var name in names) {
                var hemi = geometries[names[name]];
                posdata[name].push(hemi.attributes.position);

                //Put attributes in the correct locations for the shader
                if (hemi.attributes['wm'] !== undefined) {
                    this.volume = 1;
                    hemi.attributes['position2'] = hemi.attributes['wm'];
                    hemi.attributes['position2'].stride = 4;
                    hemi.attributes['position2'].itemSize = 3;
                    hemi.attributes['normal2'] = module.computeNormal(hemi.attributes['wm'], hemi.attributes.index, hemi.offsets);
                    delete hemi.attributes['wm'];
                }
                for (var i = 0; i < json.names.length; i++ ) {
                    hemi.attributes['mixSurfs'+i] = hemi.attributes[json.names[i]];
                    hemi.attributes['mixSurfs'+i].stride = 4;
                    hemi.attributes['mixSurfs'+i].itemSize = 3;
                    hemi.attributes['mixNorms'+i] = module.computeNormal(hemi.attributes[json.names[i]], hemi.attributes.index, hemi.offsets);
                    posdata[name].push(hemi.attributes['mixSurfs'+i]);
                    delete hemi.attributes[json.names[i]];
                }

                if (this.flatlims !== undefined) {
                    var flats = this._makeFlat(hemi.attributes.uv.array, json.flatlims, names[name]);
                    hemi.attributes['mixSurfs'+json.names.length] = {itemSize:3, array:flats.pos};
                    hemi.attributes['mixNorms'+json.names.length] = {itemSize:3, array:flats.norms};
                    posdata[name].push(hemi.attributes['mixSurfs'+json.names.length]);
                }

                hemi.dynamic = true;
                var meshpiv = this._makeMesh(hemi, null);

                this.meshes[name] = meshpiv.mesh;
                this.pivot[name] = meshpiv.pivots;
                this.object.add(meshpiv.pivots.front);
            }


            //Add anatomical and flat names
            this.names.unshift("anatomicals");
            if (this.flatlims !== undefined) {
                this.names.push("flat");
            }

            this.viewer.canvas[0].style.opacity = 1;
            this.loaded.resolve();

        }.bind(this), {useWorker:true});
    };
    module.Surface.prototype.apply = function(dataview) {
        if (dataview instanceof dataset.DataView) {
            var shader = dataview.getShader(Shaders.surface, this.uniforms, {
                morphs:this.names.length, 
                volume:this.volume, 
                rois:  false});
            this.meshes.left.material = shader[0];
            this.meshes.right.material = shader[0];
        } else {
            var shadecode = Shaders.surf_plain(false, false, viewopts.voxlines, this.names.length);
            var shader = new THREE.ShaderMaterial({ 
                vertexShader:shadecode.vertex,
                fragmentShader:shadecode.fragment,
                attributes: shadecode.attrs,
                uniforms: this.uniforms,
                lights:true, 
                blending:THREE.CustomBlending,
            });
            shader.metal = true;
            this.meshes.left.material = shader;
            this.meshes.right.material = shader;
        }
        this.viewer.schedule();
    };
    module.Surface.prototype.handleEvent = function(event) {

    };

    module.Surface.prototype.rotate = function(x, y) {
        //Rotate the surface given the X and Y mouse displacement
        this.rotation[0] += x;
        this.rotation[1] += y;
        this.rotation[0] = this.rotation[0] % 360;
        this.rotation[1] = -90 < this.rotation[1] ? (this.rotation[1] < 90 ? this.rotation[1] : 90) : -90;
        this.object.rotation.set(0,0,0, 'ZYX');
        this.object.rotateX(this.rotation[1] * Math.PI / 180);
        this.object.rotateZ(this.rotation[0] * Math.PI / 180);
        this.viewer.schedule();
    }

    module.Surface.prototype.setMix = function(mix) {
        this.uniforms.surfmix.value = mix;
        var smix = mix * (this.names.length - 1);
        var factor = 1 - Math.abs(smix - (this.names.length-1));
        var clipped = 0 <= factor ? (factor <= 1 ? factor : 1) : 0;
        this.uniforms.specularStrength.value = 1-clipped;
        this.setPivot( 180 * clipped);
        //this.viewer.schedule();
    };
    module.Surface.prototype.setPivot = function (val) {
        this._pivot = val;
        var names = {left:1, right:-1}
        if (val > 0) {
            for (var name in names) {
                this.pivot[name].front.rotation.z = 0;
                this.pivot[name].back.rotation.z = val*Math.PI/180 * names[name]/ 2;
            }
        } else {
            for (var name in names) {
                this.pivot[name].back.rotation.z = 0;
                this.pivot[name].front.rotation.z = val*Math.PI/180 * names[name] / 2;
            }
        }
        this.viewer.schedule();
    };
    module.Surface.prototype.setShift = function(val) {
        this.pivot.left.front.position.x = -val;
        this.pivot.right.front.position.x = val;
    };

    module.Surface.prototype._makeMesh = function(geom, shader) {
        //Creates the pivots and the mesh object given the geometry and shader
        var mesh = new THREE.Mesh(geom, shader);
        mesh.position.y = -this.flatoff[1];
        mesh.updateMatrix();
        var pivots = {back:new THREE.Object3D(), front:new THREE.Object3D()};
        pivots.back.add(mesh);
        pivots.front.add(pivots.back);
        pivots.back.position.y = geom.boundingBox.min.y - geom.boundingBox.max.y;
        pivots.front.position.y = geom.boundingBox.max.y - geom.boundingBox.min.y + this.flatoff[1];

        return {mesh:mesh, pivots:pivots};
    };

    module.Surface.prototype._makeFlat = function(uv, flatlims, right) {
        var fmin = flatlims[0], fmax = flatlims[1];
        var flat = new Float32Array(uv.length / 2 * 3);
        var norms = new Float32Array(uv.length / 2 * 3);
        for (var i = 0, il = uv.length / 2; i < il; i++) {
            if (right) {
                flat[i*3+1] = flatscale*uv[i*2] + this.flatoff[1];
                norms[i*3] = 1;
            } else {
                flat[i*3+1] = flatscale*-uv[i*2] + this.flatoff[1];
                norms[i*3] = -1;
            }
            flat[i*3+2] = flatscale*uv[i*2+1];
            uv[i*2]   = (uv[i*2]   + fmin[0]) / fmax[0];
            uv[i*2+1] = (uv[i*2+1] + fmin[1]) / fmax[1];
        }

        return {pos:flat, norms:norms};
    }

    return module;
}(mriview || {}));