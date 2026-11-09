# Three.js 0.187.0 (vendored for the Quick Print 3D view, A19 P7)

- Release: `three@0.187.0`, published to npm 2026-10-30. Source: https://registry.npmjs.org/three/-/three-0.187.0.tgz
  (repository https://github.com/mrdoob/three.js, tag r187). Fetched with `npm pack three@0.187.0`.
- Licence: MIT, © 2010-2026 three.js authors (`LICENSE` here is the package's own file).
- Loaded only by `hub/static/js/quick-3d.js`, which is imported lazily from the Quick Print page and nowhere else
  (`tests/test_quick_3d.py` checks that).
- Files are the unminified module build; nothing was edited except the one line noted below.

| File here | Origin in the package | sha256 |
|---|---|---|
| `three.module.js` | `build/three.module.js` | `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341` |
| `three.core.js` | `build/three.core.js` | `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578` |
| `LICENSE` | `LICENSE` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` (original sha256 `e7fca2fe9e7670a828af9b28084669a5909445b7f36f1f26cee9bf8f2961c32c`) | `a747d56dd959510407777f1800792b2b52c0a435980fd6e40caf303d8a674b9e` |

The one edit: line 12 of `OrbitControls.js`, `} from 'three';` became `} from './three.module.js';`, so the file loads
without an import map. To upgrade, repeat the pack, replace all four files, update this table and the path in
`quick-3d.js`; `tests/test_quick_3d.py` fails until the hashes match.
