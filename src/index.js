// Copyright (c) 2019 Alexander Perrin contact@alexperrin.com

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

require("../node_modules/three/src/loaders/ObjectLoader");
require("../node_modules/three/examples/js/controls/OrbitControls");
require("../lib/THREE.MeshLine");

import Detector from "../lib/Detector";
import Player from "./classes/player";
import * as THREE from "three";
import TerrainPatch from "./classes/terrain-patch";
import Heightmap from "./classes/heightmap";
import Bird from "./classes/bird";
import Random from "./classes/random";

(function() {
  if ("performance" in window == false) {
    window.performance = {};
  }

  Date.now =
    Date.now ||
    function() {
      // thanks IE8
      return new Date().getTime();
    };

  if ("now" in window.performance == false) {
    var nowOffset = Date.now();

    if (performance.timing && performance.timing.navigationStart) {
      nowOffset = performance.timing.navigationStart;
    }

    window.performance.now = function now() {
      return Date.now() - nowOffset;
    };
  }
})();

(function() {
  // Rendering
  const SHADOW_MAP_WIDTH = 1024;
  const SHADOW_MAP_HEIGHT = 1024;
  const SHADOW_CAM_SIZE = 512;
  const SHADOW_CAM_STEP = 16;

  // File
  const IMAGE_PATH = "static/images/";
  const MESH_PATH = "static/meshes/";

  let meshFiles = [
    "tree.json",
    "balloon.json",
    "boat01.json",
    "pier01.json",
    "church01.json",
  ];
  let imageFiles = [];

  let objectLoader = new THREE.ObjectLoader();

  // Data storage
  let meshes = {};
  let textures = {};

  // Birds
  const BIRD_COUNT = 40;
  const BIRD_SPAWN_DISTANCE = -200;
  let birds = [];

  // Lights, camera and helpers
  let renderer,
    scene,
    cameraControls,
    sun, // Directional light
    cameraAnchor, // Camera base rotator
    gameCamera, // Game view camera
    renderCamera, // Currently rendering camera
    editorCamera, // Utility view camera
    lightAnchor, // Used for containing sun object and target in more managable unit
    lightPosIndex, // Used for tracking movment of light
    lightShadowOffset, // Used for offsetting shadow camera matrix
    clock,
    _this,
    loadingMessage,
    player;

  // Boats
  const DEPTH_FOR_BOAT = -21;

  // Random object spawn chances
  const CHANCE_FOR_DOCK = 0.05;
  const CHANCE_FOR_CHURCH = 0.1;

  // Random generators
  let random = new Random("jfw3uhfoi44");
  let birdRandom = new Random("9ehg0wj40jf");

  // Debug rays
  let rays = [];

  // Terrain
  const TERRAIN_PATCH_WIDTH = 64;
  const TERRAIN_PATCH_HEIGHT = 64;
  const TERRAIN_PATCHES_X = 6;
  const TERRAIN_PATCHES_Z = 12;
  const TERRAIN_OFFSET_X = -TERRAIN_PATCHES_X * 0.5 * TERRAIN_PATCH_WIDTH;
  const TERRAIN_OFFSET_Z = -128;
  const TREES_PER_TERRAIN = 50;
  const WATER_HEIGHT = -15.0;
  let heightmap = new Heightmap({
    noiseOffset: {
      x: 0,
      y: -TERRAIN_OFFSET_Z,
    },
    height: 50,
    scale: 100,
  });
  let terrainPatches = [];
  let waterPlane;
  // Used for tracking terrain regeneration requirement
  let terrainGridIndex = {
    x: 0,
    y: 0,
  };

  // Shaders
  let standardShader;

  // Input
  let input = {
    x: 0,
    y: 0,
  };

  /**
   * @summary Window focus detection.
   * @description Stops the animation clock when window is inactive.
   */
  (function() {
    var hidden = "hidden";

    // Standards:
    if (hidden in document)
      document.addEventListener("visibilitychange", onchange);
    else if ((hidden = "mozHidden") in document)
      document.addEventListener("mozvisibilitychange", onchange);
    else if ((hidden = "webkitHidden") in document)
      document.addEventListener("webkitvisibilitychange", onchange);
    else if ((hidden = "msHidden") in document)
      document.addEventListener("msvisibilitychange", onchange);
    // IE 9 and lower:
    else if ("onfocusin" in document)
      document.onfocusin = document.onfocusout = onchange;
    // All others:
    else
      window.onpageshow = window.onpagehide = window.onfocus = window.onblur = onchange;

    function onchange(evt) {
      if (document[hidden]) {
        if (clock !== undefined) {
          clock.stop();
        }
      } else {
        if (clock !== undefined) {
          clock.start();
        }
      }
      var v = "visible",
        h = "hidden",
        evtMap = {
          focus: v,
          focusin: v,
          pageshow: v,
          blur: h,
          focusout: h,
          pagehide: h,
        };

      evt = evt || window.event;
      if (evt.type in evtMap) document.body.className = evtMap[evt.type];
      else document.body.className = this[hidden] ? "hidden" : "visible";
    }

    // set the initial state (but only if browser supports the Page Visibility API)
    if (document[hidden] !== undefined)
      onchange({
        type: document[hidden] ? "blur" : "focus",
      });
  })();

  /**
   * Gets the device pixel ratio.
   * @return float the ratio
   */
  let getDevicePixelRatio = function() {
    return window.devicePixelRatio || 1;
  };

  /**
   * Adds an event to the object
   * @param {object}   object   object to add event to
   * @param {string}   type     event type
   * @param {Function} callback event handler
   */
  let addEvent = function(object, type, callback) {
    if (object === null || typeof object === "undefined") return;
    if (object.addEventListener) {
      object.addEventListener(type, callback, false);
    } else if (object.attachEvent) {
      object.attachEvent("on" + type, callback);
    } else {
      object["on" + type] = callback;
    }
  };

  let updateRenderCamera = function() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    renderCamera.aspect = width / height;
    renderCamera.updateProjectionMatrix();
  };

  /**
   * Resize function
   * @param  double width
   * @param  double height
   */
  let resize = function() {
    let width = window.innerWidth;
    let height = window.innerHeight;
    let devicePixelRatio = getDevicePixelRatio();
    renderer.setSize(width * devicePixelRatio, height * devicePixelRatio);

    // Update canvas
    let canvas = renderer.domElement;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    updateRenderCamera();
  };

  /**
   * Shifts the terrain by given units
   * @param  {[type]} x terrain units to shift in x
   * @param  {[type]} y terrain units to shift in y
   */
  let shiftTerrain = function(x, y) {
    // Shift forward
    for (let i = 0; i < y; ++i) {
      for (let j = 0; j < TERRAIN_PATCHES_X; ++j) {
        let tp = terrainPatches[terrainGridIndex.y % TERRAIN_PATCHES_Z][j];
        tp.position.z += TERRAIN_PATCH_HEIGHT * TERRAIN_PATCHES_Z;
        tp.rebuild(scene);
      }
    }
    spawnObjectsForTerrainPatches(
      terrainPatches[terrainGridIndex.y % TERRAIN_PATCHES_Z],
    );

    terrainGridIndex.y += y;
    waterPlane.position.z += TERRAIN_PATCH_HEIGHT * y;
  };

  let spawnObjectsForTerrainPatches = function(terrainPatches) {
    let data = [];
    terrainPatches.forEach(v => {
      data = data.concat(v.getNiceHeightmapData());
    });

    let boatSpawnPoints = [];
    let pierSpawnPoints = [];
    let buildingSpawnPoints = [];

    // Iterate through heightmap to find appropriate places for spawning objects
    data.forEach(v => {
      // Find suitable positions for spawning boats
      if (v.position.y <= DEPTH_FOR_BOAT && v.normal.y >= 0.99) {
        boatSpawnPoints.push(v);
      }
      if (
        Math.abs(v.position.y - (WATER_HEIGHT + 0.5)) < 1.5 &&
        v.normal.y > 0.7
      ) {
        pierSpawnPoints.push(v);
      }
      if (v.position.y > WATER_HEIGHT && v.normal.y > 0.95) {
        buildingSpawnPoints.push(v);
      }
    });

    if (randomChance(CHANCE_FOR_DOCK)) {
      // Boat spawning
      if (boatSpawnPoints.length > 0) {
        // Spawn a patch of boats
        let numBoats = Math.ceil(random.range(1, 5));
        let point =
          boatSpawnPoints[Math.floor(random.range(0, boatSpawnPoints.length))];
        for (let i = 0; i < numBoats; ++i) {
          let angle = random.range(0, Math.PI * 2);
          let dist = i * 5;
          let boat = meshes["boat"].clone();
          boat.castShadow = true;
          let scale = random.range(0.5, 0.75);
          boat.scale.set(scale, scale, scale);
          boat.rotation.y = random.range(0, Math.PI * 2);
          let xOffset = Math.cos(angle) * dist;
          let zOffset = Math.sin(angle) * dist;
          boat.position.set(
            point.position.x + xOffset,
            WATER_HEIGHT + 0.5 * scale,
            point.position.z + zOffset,
          );
          scene.add(boat);
        }
      }

      // Pier spawning
      let numPiers = Math.ceil(random.range(1, 3));
      if (pierSpawnPoints.length > 0) {
        for (let i = 0; i < numPiers; ++i) {
          let v =
            pierSpawnPoints[
              Math.floor(random.range(0, pierSpawnPoints.length))
            ];
          // Check that there's enough room for the pier to be placed in the water
          let offset = new THREE.Vector2(v.normal.x, v.normal.z)
            .normalize()
            .multiplyScalar(20);
          let pierPos = new THREE.Vector3(
            v.position.x + offset.x,
            WATER_HEIGHT,
            v.position.z + offset.y,
          );
          let depthPos = sampleLandscapePosition(pierPos);
          if (depthPos !== undefined) {
            if (depthPos.y < DEPTH_FOR_BOAT * 0.75) {
              let pos = new THREE.Vector3();
              pos.copy(v.position);
              let waterDiff = pos.y - WATER_HEIGHT;
              let dir = new THREE.Vector3(
                v.normal.x,
                0,
                v.normal.z,
              ).multiplyScalar((waterDiff / (1.0 - v.normal.y)) * 0.5);
              pos.y -= waterDiff;
              pos.add(dir);

              let rotation = Math.atan2(v.normal.x, v.normal.z);
              let pier = meshes["pier"].clone();
              pier.scale.set(1.5, 1.5, 1.5);
              pier.position.set(pos.x, WATER_HEIGHT + 1.5, pos.z);
              pier.castShadow = true;
              pier.rotation.z = rotation + Math.PI / 2;
              scene.add(pier);
            }
          }
        }
      }
    }

    if (randomChance(CHANCE_FOR_CHURCH)) {
      let point =
        buildingSpawnPoints[
          Math.floor(random.range(0, buildingSpawnPoints.length))
        ];
      let pos = point.position;
      let rotation = Math.atan2(point.normal.x, point.normal.z);
      let church = meshes["church"].clone();
      church.position.copy(pos);
      church.scale.multiplyScalar(1.5);
      church.position.y += 4;
      church.castShadow = true;
      church.receiveShadow = true;
      church.rotation.y = rotation - Math.PI / 2;
      scene.add(church);
    }
  };

  /**
   * Terrain grid index to world position transformation
   * @param  {int} x terrain index x
   * @param  {int} y terrain index y
   * @return {vec3}   world position
   */
  let terrainGridToWorld = function(x, y) {
    return {
      x: x * TERRAIN_PATCH_WIDTH,
      y: 0,
      z: y * TERRAIN_PATCH_HEIGHT,
    };
  };

  /**
   * Returns the terrain snapped position of the given world position.
   * Returns undefined if position is not over landscape.
   */
  let sampleLandscapePosition = function(worldPosition) {
    for (let i = 0; i < TERRAIN_PATCHES_Z; ++i) {
      for (let j = 0; j < TERRAIN_PATCHES_X; ++j) {
        if (terrainPatches[i][j].containsWorldPosition(worldPosition)) {
          return terrainPatches[i][j].getPosition(worldPosition);
        }
      }
    }
    return undefined;
  };

  let sampleLandscapeNormal = function(worldPosition) {
    for (let i = 0; i < TERRAIN_PATCHES_Z; ++i) {
      for (let j = 0; j < TERRAIN_PATCHES_X; ++j) {
        if (terrainPatches[i][j].containsWorldPosition(worldPosition)) {
          return terrainPatches[i][j].getNormal(worldPosition);
        }
      }
    }
    return undefined;
  };

  /**
   * World position to terrain grid index transformation
   * @param  {vec3} pos world position
   * @return {vec2}     terrain index
   */
  let worldToTerrainGrid = function(pos) {
    return {
      x: Math.round(pos.x / TERRAIN_PATCH_WIDTH),
      y: Math.round(pos.z / TERRAIN_PATCH_HEIGHT),
    };
  };

  /// Gets a random position on the entire landscape
  let getRandomPositionOnLandscape = function() {
    return {
      x:
        getRandomArbitrary(0, TERRAIN_PATCHES_X * TERRAIN_PATCH_WIDTH) +
        TERRAIN_OFFSET_X,
      y: 0,
      z:
        getRandomArbitrary(0, TERRAIN_PATCHES_Z * TERRAIN_PATCH_HEIGHT) +
        TERRAIN_OFFSET_Z,
    };
  };

  /**
   * Coin flip random chance selector.
   * @param {Number} chance the chance between 0 and 1.
   * @return {Boolean} whether the random chance occurred.
   */
  let randomChance = function(chance) {
    return random.range(0, 1) + chance > 1.0;
  };

  /**
   * Get the x midpoint of the terrain.
   * @return {Number} the x midpoint.
   */
  let getLandscapeMidpoint = function() {
    return {
      x: (TERRAIN_PATCHES_X * TERRAIN_PATCH_WIDTH) / 2 + TERRAIN_OFFSET_X,
    };
  };

  /**
   * Get the width of the terrain.
   * @return {Number} the width.
   */
  let getLandscapeWidth = function() {
    return TERRAIN_PATCHES_X * TERRAIN_PATCH_WIDTH;
  };

  /**
   * Get the depth of the terrain.
   * @return {Number} the depth.
   */
  let getLandscapeDepth = function() {
    return TERRAIN_PATCHES_Z * TERRAIN_PATCH_HEIGHT;
  };

  /**
   * Render the scene.
   */
  let render = function() {
    renderer.render(scene, renderCamera);
  };

  /**
   * Parses a shader from the THREE shader chunk library
   * @param  {String} shaderStr the raw GLSL shader string.
   * @return {String} the parsed shader code.
   */
  let getShader = function(shaderStr) {
    return shaderStr.replace(/#include\s+(\S+)/gi, function(match, p1) {
      p1 = p1.substr(1, p1.length - 2);
      var chunk = THREE.ShaderChunk[p1];
      return chunk ? chunk : "";
    });
  };

  /**
   * Load the meshes required for playing the application.
   * @param {Function} callback the callback to execute when meshes are loaded.
   */
  let loadMeshes = function(callback) {
    loadingMessage.innerText = "geometry";

    let numFiles = meshFiles.length;
    if (numFiles === 0) {
      callback();
    }
    meshFiles.forEach(v => {
      objectLoader.load(MESH_PATH + v, obj => {
        let name = obj.name;
        meshes[name] = obj;
        numFiles--;
        if (numFiles === 0) {
          callback();
        }
      });
    });
  };

  /**
   * Load the textures required to play the application.
   */
  let loadTextures = function(callback) {
    loadingMessage.innerText = "images";

    let numFiles = imageFiles.length;
    if (numFiles === 0) {
      callback();
    }
    imageFiles.forEach(v => {
      let texture = new THREE.Texture();
      let image = new Image();
      image.onload = function() {
        texture.image = image;
        texture.needsUpdate = true;
        texture.name = v;
        textures[v] = texture;
        numFiles--;
        if (numFiles === 0) {
          callback();
        }
      };
      image.src = IMAGE_PATH + v;
    });
  };

  /**
   * Initialise the THREE WebGL renderer and append to DOM.
   */
  let initRenderer = function() {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
    });
    renderer.setClearColor("white", 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document
      .getElementById("canvas-container")
      .appendChild(renderer.domElement);

    let mat = new THREE.ShaderMaterial({
      lights: true,
      uniforms: THREE.ShaderLib.phong.uniforms,
      uniforms: THREE.UniformsUtils.merge([
        THREE.ShaderLib.phong.uniforms,
        {
          xFogColor: {
            type: "c",
            value: new THREE.Color(0xffffff),
          },
        },
      ]),
      shading: THREE.FlatShading,
      fog: true,
      vertexShader: standardShader.vertexShader,
      fragmentShader: standardShader.fragmentShader,
      vertexColors: THREE.VertexColors,
    });

    // Assign materials
    Object.keys(meshes).forEach(v => {
      let m = meshes[v];
      m.material = mat;
    });
  };

  /**
   * Initialise the base scene objects and helpers.
   */
  let initScene = function() {
    scene = new THREE.Scene();
    lightShadowOffset = new THREE.Object3D();

    // Used for storing sun shadow camera and target
    lightAnchor = new THREE.Object3D();
    scene.add(lightAnchor);
    lightAnchor.add(lightShadowOffset);

    // Used for transforming light and shadow cameras
    let lightMatrix = new THREE.Matrix4();
    let rotation = new THREE.Quaternion();
    rotation.setFromEuler(
      new THREE.Euler(
        THREE.Math.degToRad(35),
        THREE.Math.degToRad(-135),
        0,
        "YXZ",
      ),
    );
    lightMatrix.compose(
      new THREE.Vector3(0, 128, 0),
      rotation,
      new THREE.Vector3(1, 1, 1),
    );

    // Lights
    sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0, 0, 0);
    sun.target.position.set(0, 0, 128);
    scene.add(new THREE.AmbientLight(0xeeeeff, 0.5));
    scene.fog = new THREE.Fog(0xdaf0fb, 350, 950);
    let hemiLight = new THREE.HemisphereLight(0xffffff, 0xffed00, 0.25);
    hemiLight.position.set(0, 500, 0);
    scene.add(hemiLight);

    // Shadows
    sun.castShadow = true;
    sun.shadow.mapSize.width = SHADOW_MAP_WIDTH;
    sun.shadow.mapSize.height = SHADOW_MAP_HEIGHT;
    let sCamSize = SHADOW_CAM_SIZE;
    sun.shadow.camera.right = -sCamSize / 2;
    sun.shadow.camera.left = sCamSize / 2;
    sun.shadow.camera.top = sCamSize / 2;
    sun.shadow.camera.bottom = -sCamSize / 2;
    sun.shadow.camera.far = 512;
    sun.shadow.camera.near = -512;
    sun.shadow.bias = -0.0025;

    // Shadow camera position texel snapping compensator
    lightShadowOffset.add(sun);
    lightShadowOffset.add(sun.target);
    lightAnchor.applyMatrix(lightMatrix);
    lightPosIndex = lightAnchor.position.z;
    lightAnchor.position.z += 400;

    window.flight.scene = scene;
  };

  /**
   * Parse the glsl shaders.
   */
  let initShaders = function() {
    standardShader = {
      vertexShader: getShader(require("./shaders/standard_vert.glsl")),
      fragmentShader: getShader(require("./shaders/standard_frag.glsl")),
    };
  };

  /**
   * Initialise the terrain materials and geometry.
   */
  let initTerrain = function() {
    // Shader uniforms
    let uniforms = {
      cliffColor: {
        type: "c",
        value: new THREE.Color(0x555555),
      },
      grassColor: {
        type: "c",
        value: new THREE.Color(0x475905),
      },
      sandColor: {
        type: "c",
        value: new THREE.Color(0x886633),
      },
      steps: {
        type: "f",
        value: 1.0,
      },
      waterHeight: {
        type: "f",
        value: WATER_HEIGHT + 0.5,
      },
      xFogColor: {
        type: "c",
        value: new THREE.Color(0xffffff),
      },
      threshold: {
        type: "f",
        value: 0.25,
      },
    };

    // Materials
    let landscapeMaterial = new THREE.ShaderMaterial({
      lights: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.ShaderLib.phong.uniforms,
        uniforms,
      ]),
      shading: THREE.FlatShading,
      fog: true,
      vertexShader: getShader(require("./shaders/landscape_vert.glsl")),
      fragmentShader: getShader(require("./shaders/landscape_frag.glsl")),
    });

    // Terrain patches
    for (let i = 0; i < TERRAIN_PATCHES_Z; ++i) {
      terrainPatches[i] = [];
      for (let j = 0; j < TERRAIN_PATCHES_X; ++j) {
        let tp = new TerrainPatch({
          width: TERRAIN_PATCH_WIDTH,
          height: TERRAIN_PATCH_HEIGHT,
          position: new THREE.Vector3(
            TERRAIN_PATCH_WIDTH * j + TERRAIN_OFFSET_X,
            0,
            TERRAIN_PATCH_HEIGHT * i + TERRAIN_OFFSET_Z,
          ),
          heightmap: heightmap,
          material: landscapeMaterial,
          debug: false,
        });
        tp.receiveShadow = true;
        tp.castShadow = true;
        tp.addScatterObject({
          mesh: meshes["tree"],
          count: TREES_PER_TERRAIN,
          minSize: {
            x: 0.25,
            y: 0.4,
            z: 0.25,
          },
          maxSize: {
            x: 0.5,
            y: 0.5,
            z: 0.5,
          },
          lockXZScale: true,
          minHeight: -10,
          maxHeight: 100,
          maxSlope: 0.6,
        });
        terrainPatches[i][j] = tp;
        scene.add(terrainPatches[i][j]);
      }
    }

    for (let i = 0; i < TERRAIN_PATCHES_Z; ++i) {
      spawnObjectsForTerrainPatches(terrainPatches[i]);
    }

    // River plane
    let riverMaterial = new THREE.MeshPhongMaterial({
      color: 0x111111,
    });
    riverMaterial.emissive = new THREE.Color(0x5c9fab);
    let riverMesh = new THREE.PlaneGeometry(
      TERRAIN_PATCHES_X * TERRAIN_PATCH_WIDTH,
      TERRAIN_PATCHES_Z * TERRAIN_PATCH_HEIGHT * 2,
      1,
      1,
    );
    waterPlane = new THREE.Mesh(riverMesh, riverMaterial);
    waterPlane.receiveShadow = true;
    waterPlane.position.y = -15;
    waterPlane.rotation.x = -Math.PI / 2.0;
    waterPlane.position.z = -TERRAIN_OFFSET_X;
    scene.add(waterPlane);
  };

  /**
   * Create our balloon friend and add to scene.
   */
  let initPlayer = function() {
    let obj = meshes["balloon"];
    player = new Player();
    player.position.set(0, 100, 0);
    player.add(obj);
    scene.add(player);
  };

  /**
   * Initialise camera systems.
   */
  let initCameras = function() {
    // Game camera
    gameCamera = new THREE.PerspectiveCamera(
      15.0,
      window.innerWidth / window.innerHeight,
      100,
      10000,
    );
    cameraAnchor = new THREE.Object3D();
    cameraAnchor.position.set(
      (TERRAIN_PATCHES_X * TERRAIN_PATCH_WIDTH) / 2,
      0,
      (TERRAIN_PATCHES_Z * TERRAIN_PATCH_HEIGHT) / 2,
    );
    cameraAnchor.updateMatrix();
    cameraAnchor.add(gameCamera);
    gameCamera.position.set(100, 250, -300);
    gameCamera.lookAt(new THREE.Vector3(0, 100, 0));
    scene.add(cameraAnchor);

    // Editor camera
    editorCamera = gameCamera.clone();
    cameraControls = new THREE.OrbitControls(editorCamera, renderer.domElement);
    cameraControls.target.set(
      0,
      0,
      (TERRAIN_PATCHES_Z * TERRAIN_PATCH_HEIGHT) / 2,
    );
    editorCamera.position.set(-250, 350, -250);
    cameraControls.update();

    renderCamera = gameCamera;
  };

  /**
   * Move the birds back to the start of their flight.
   * This will be invoked every now and again to loop the bird flight.
   */
  let respawnBirds = function() {
    let spawnWidth = getLandscapeWidth() * 0.25;
    let bunchFactor = birdRandom.range(0.2, 1);
    let flockPosition = new THREE.Vector3(
      birdRandom.range(-spawnWidth, spawnWidth),
      birdRandom.range(64, 128),
      player.position.z + BIRD_SPAWN_DISTANCE,
    );
    let birdPos;
    for (let i = 0; i < BIRD_COUNT; ++i) {
      birdPos = flockPosition
        .clone()
        .add(
          new THREE.Vector3(
            birdRandom.range(-32, 32) * bunchFactor,
            birdRandom.range(-16, 16) * bunchFactor,
            birdRandom.range(-48, 48) * bunchFactor,
          ),
        );
      birds[i].position.copy(birdPos);
    }
    // Loop this function every so often
    setTimeout(respawnBirds, 30000 + birdRandom.range(0, 20000));
  };

  /**
   * Hatch some new birds.
   */
  let initBirds = function() {
    for (let i = 0; i < BIRD_COUNT; ++i) {
      let bird = new Bird();
      scene.add(bird);
      birds.push(bird);
    }
    respawnBirds();
  };

  /**
   * Initialise the core application.
   */
  let init = function() {
    loadingMessage.innerText = "world";

    window.flight = {};
    clock = new THREE.Clock(true);
    window.flight.clock = clock;
    window.flight.input = 0;
    window.flight.debug = {};
    window.flight.debug.drawRay = drawRay;

    initShaders();
    initRenderer();
    initScene();
    initPlayer();
    initCameras();
    initBirds();
    initTerrain();

    let a = new THREE.AxisHelper(20);
    a.position.set(0, 0, 0);
    scene.add(a);

    // Events
    addEvent(window, "resize", resize);

    addEvent(window, "keydown", function(e) {
      // Inputs
      if (e.keyCode === 39) {
        input.x = 1.0;
      } else if (e.keyCode === 37) {
        input.x = -1.0;
      } else if (e.keyCode === 32) {
        // Camera switching
        if (renderCamera === editorCamera) {
          renderCamera = gameCamera;
        } else {
          renderCamera = editorCamera;
        }
      }
    });

    window.addEventListener("touchmove", function(e) {
      // Prevent scroll behaviour
      if (!event.target.classList.contains("scrollable")) {
        event.preventDefault();
      }
    });

    window.addEventListener("mousewheel", function(e) {
      // Disable mouse wheel scrolling
      e.preventDefault();
    });

    addEvent(window, "touchstart", function(e) {
      let mp = window.innerWidth / 2;
      let p = e.touches[0].clientX;
      if (p - mp < 0) {
        // Go left
        input.x = -1;
      } else if (p - mp > 0) {
        // Go right
        input.x = 1;
      }
    });

    window.addEventListener("touchend", function() {
      input.x = 0;
    });

    addEvent(window, "keyup", function(e) {
      // Inputs
      if (e.keyCode === 39) {
        input.x = 0;
      } else if (e.keyCode === 37) {
        input.x = 0;
      }
    });

    resize();
    idle();

    // Silly hack to prevent the perf hiccup ruining the fade effect
    setTimeout(() => {
      document.querySelector("#loader").hidden = true;
    }, 100);
  };

  /**
   * Ray drawing util inspired by Unity's approach.
   * Not performant at all, but very useful for quick draws.
   */
  let drawRay = function(position, direction, color, duration) {
    var material = new THREE.LineBasicMaterial({
      color: color,
    });

    var geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3(), direction.clone());

    var line = new THREE.Line(geometry, material);
    line.position.copy(position);
    rays.push({
      line: line,
      killTime: window.flight.time + duration,
    });
    scene.add(line);
  };

  /**
   * Idle/animate loop called every animation frame tick.
   */
  let idle = function() {
    let dt = clock.getDelta();
    window.flight.deltaTime = dt;
    window.flight.input = input;
    window.flight.time = clock.getElapsedTime();

    // Update shadow camera position
    lightAnchor.position.z = player.position.z + 256;
    if (Math.round(lightAnchor.position.z) - lightPosIndex > SHADOW_CAM_STEP) {
      lightPosIndex = Math.round(lightAnchor.position.z);
      lightAnchor.updateMatrixWorld();
      // Snap the shadow camera matrix to the nearest texel to prevent shadow swimming
      let lPos = new THREE.Vector3(0, 0, 0); // Real shadow cam position
      let lPos2 = new THREE.Vector3(0, 0, 0); // Texel snapped cam position
      lightAnchor.worldToLocal(lPos);
      lPos2.set(lPos.x, lPos.y, lPos.z);
      let tSize = SHADOW_CAM_SIZE / SHADOW_MAP_WIDTH;
      lPos2.x = Math.round(lPos2.x / tSize) * tSize;
      lPos2.y = Math.round(lPos2.y / tSize) * tSize;
      lightShadowOffset.position.set(lPos.x - lPos2.x, lPos.y - lPos2.y, 0);
      renderer.shadowMap.needsUpdate = true;
    }

    if (player) {
      player.update();
      player.gridPos = worldToTerrainGrid(player.position);
      // Check for terrain shift
      while (player.gridPos.y > terrainGridIndex.y) {
        shiftTerrain(0, 1);
      }
      cameraAnchor.position.set(player.position.x, 0, player.position.z);
      if (cameraAnchor.position.x > 60) {
        cameraAnchor.position.x = 60;
      } else if (cameraAnchor.position.x < -60) {
        cameraAnchor.position.x = -60;
      }
    }

    // Animate birds
    let avBirdPos = new THREE.Vector3();
    birds.forEach(b => {
      avBirdPos.add(b.position);
    });
    avBirdPos.divideScalar(birds.length);
    // Basic flocking
    birds.forEach(b => {
      b.update(dt, avBirdPos, player);
    });

    requestAnimationFrame(idle);
    render();

    // Remove the rays
    let t = window.flight.time;
    rays.forEach(r => {
      if (t > r.killTime) {
        scene.remove(r.line);
      }
    });
  };

  document.addEventListener("DOMContentLoaded", function() {
    loadingMessage = document.querySelector("#loading-message");

    if (!Detector.webgl || !Detector.canvas) {
      document.querySelector(".label").innerText =
        "My apologies, your device doesn't support WebGL, which is what this thing relies on! Try updating it, or try another one.";
    } else {
      loadingMessage.innerText = "code";
    }

    loadTextures(() => {
      loadMeshes(() => {
        init();
      });
    });
  });

  _this = this;
})();
