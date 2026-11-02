three.js 0.187.0 (MIT): только то, что нужно Clown Dungeon, чтобы показать .glb.
Собрано esbuild из npm-пакета three: WebGLRenderer, Scene, PerspectiveCamera, Group, Box3, Vector3,
HemisphereLight, DirectionalLight, GLTFLoader. Нужен другой класс — допиши в список и пересобери:
  esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=three-gltf.min.js
