three.js 0.187.0 (MIT): только нужные классы (Clown Dungeon, 3D-просмотр фото).
Собрано esbuild из npm-пакета three: WebGLRenderer, Scene, PerspectiveCamera, Group, Box3, Vector3, Vector2,
HemisphereLight, DirectionalLight, AmbientLight, NearestFilter, GLTFLoader, BufferGeometry, BufferAttribute,
Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshLambertMaterial, Raycaster, Plane, PlaneGeometry, GridHelper, Points, PointsMaterial, Sphere,
Color, Euler, Quaternion, Matrix4, DoubleSide, Fog, SphereGeometry, LineBasicMaterial, LineSegments, Line
(Clown Dungeon — .glb; просмотрщик фото и тулчейн — 3D-сцены из вокселей). Нужен другой класс — допиши в список и пересобери:
  esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=three-gltf.min.js
