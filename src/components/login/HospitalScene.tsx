import * as React from "react";
import * as THREE from "three";

/** Share of ward windows lit in each shift (morning 07 to 15, evening 15 to 23, night 23 to 07). */
export function litShare(hour: number): number {
  if (hour >= 7 && hour < 15) return 0.72;
  if (hour >= 15 && hour < 23) return 0.55;
  return 0.3;
}

const C = {
  ground: "#06352e",
  wall: "#0e5045",
  windowOff: "#0b3d35",
  windowOn: "#e4f7ec",
  edge: "#39edd5",
  mint: "#0ce69f",
  palm: "#0f5a48",
  trunk: "#2c4a3f",
};

interface Win { level: number; target: number; key: string }

/**
 * A hospital at the current shift: wards light and dim as staff work, the camera follows the pointer a little,
 * hovering a floor lights that ward, and dragging (or the arrow keys) turns it a full 360 degrees.
 * Built once with plain three.js; nothing loops on a reduced-motion screen.
 */
export default function HospitalScene({ className, rtl = false, label }: { className?: string; rtl?: boolean; label: string }) {
  const host = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      return; // No WebGL: the panel keeps its solid Dark Green.
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#032c26");
    scene.fog = new THREE.Fog("#032c26", 55, 105);

    scene.add(new THREE.HemisphereLight("#daf0e4", "#032c26", 0.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-18, 30, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const wallMat = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.85 });
    const edgeMat = new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.22 });
    const block = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(x, y + h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      scene.add(mesh);
      return { w, h, d, x, y, z };
    };

    // Podium (outpatient clinics and the emergency entrance), the ward tower and a side wing.
    const podium = block(18, 3, 10, 0, 0, 0);
    const tower = block(7.5, 12.1, 6, -3.5, 3, -1);
    const wing = block(5.5, 6.6, 6.5, 5.5, 3, 0.5);
    block(5, 0.25, 2, -1, 1.8, 6); // entrance canopy

    // Windows on all four sides, so the building reads from any angle once it is turned. One floor of one face is one ward.
    const wins: Win[] = [];
    const spots: { pos: THREE.Vector3; rotY: number }[] = [];
    type Side = "front" | "right" | "back" | "left";
    const ROT: Record<Side, number> = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 };
    const face = (b: typeof tower, side: Side, fromY: number, floorH: number, name: string) => {
      const span = side === "front" || side === "back" ? b.w : b.d;
      const cols = Math.floor((span - 0.8) / 1.05);
      const floors = Math.floor((b.h - (fromY - b.y) - 0.4) / floorH);
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const u = -((cols - 1) * 1.05) / 2 + c * 1.05;
          const y = fromY + f * floorH + floorH / 2;
          const pos = {
            front: new THREE.Vector3(b.x + u, y, b.z + b.d / 2 + 0.02),
            right: new THREE.Vector3(b.x + b.w / 2 + 0.02, y, b.z - u),
            back: new THREE.Vector3(b.x - u, y, b.z - b.d / 2 - 0.02),
            left: new THREE.Vector3(b.x - b.w / 2 - 0.02, y, b.z + u),
          }[side];
          spots.push({ pos, rotY: ROT[side] });
          wins.push({ level: 0, target: 0, key: `${name}-${side}-${f}` });
        }
      }
    };
    for (const side of ["front", "right", "back", "left"] as const) {
      face(tower, side, tower.y + 0.4, 1.1, "tower");
      face(wing, side, wing.y + 0.4, 1.1, "wing");
      face(podium, side, 0.5, 1.15, "podium");
    }

    const winMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.62), winMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    spots.forEach((s, i) => windows.setMatrixAt(i, m.compose(s.pos, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rotY), one)));
    scene.add(windows);

    const off = new THREE.Color(C.windowOff);
    const on = new THREE.Color(C.windowOn);
    const tmp = new THREE.Color();
    const paint = () => {
      wins.forEach((w, i) => windows.setColorAt(i, tmp.copy(off).lerp(on, w.level)));
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    };
    let share = litShare(new Date().getHours());
    wins.forEach((w) => { w.target = Math.random() < share ? 1 : 0; w.level = w.target; });
    paint();

    // The hospital sign: a solid mint cross on a panel standing on the tower roof.
    const panel = block(2.4, 2.4, 0.3, tower.x + tower.w / 2 - 1.6, tower.y + tower.h, tower.z + tower.d / 2 - 0.4);
    const signMat = new THREE.MeshBasicMaterial({ color: C.mint });
    for (const z of [panel.z + panel.d / 2 + 0.04, panel.z - panel.d / 2 - 0.04]) {
      for (const [w, h] of [[1.7, 0.5], [0.5, 1.7]] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), signMat);
        bar.position.set(panel.x, panel.y + panel.h / 2, z);
        scene.add(bar);
      }
    }

    // Date palms along the drive.
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 2.6, 6);
    const leafGeo = new THREE.ConeGeometry(0.16, 1.9, 3);
    const trunkMat = new THREE.MeshStandardMaterial({ color: C.trunk, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: C.palm, roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.3;
      palm.add(trunk);
      for (let k = 0; k < 6; k++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.y = 2.6;
        leaf.rotation.set(0, (k / 6) * Math.PI * 2, 0);
        leaf.rotateZ(1.35);
        leaf.translateY(0.85);
        leaf.castShadow = true;
        palm.add(leaf);
      }
      palm.position.set(-10 + i * 3.4, 0, 7.5);
      palm.castShadow = true;
      scene.add(palm);
    }

    // Camera: an architectural three-quarter view, the building framed to the lower right of the panel.
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
    const target = new THREE.Vector3(0.5, 5.2, 0);
    const base = { az: THREE.MathUtils.degToRad(32), el: THREE.MathUtils.degToRad(20) };
    const look = { az: base.az, el: base.el, toAz: base.az, toEl: base.el };
    const place = () => {
      const r = el.clientWidth > 520 ? 74 : 46;
      camera.position.set(
        target.x + r * Math.cos(look.el) * Math.sin(look.az),
        target.y + r * Math.sin(look.el),
        target.z + r * Math.cos(look.el) * Math.cos(look.az),
      );
      camera.lookAt(target);
    };
    const size = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      const wide = w > 520;
      // Wide: shift the frame so the building sits beside and below the headline (mirrored in Arabic). Phone strip: centred.
      camera.setViewOffset(w, h, wide ? (rtl ? w * 0.12 : -w * 0.12) : 0, wide ? -h * 0.2 : h * 0.04, w, h);
      camera.updateProjectionMatrix();
      draw();
    };
    const draw = () => { place(); renderer.render(scene, camera); };

    // Drag (or the arrow keys) turns the hospital a full 360 degrees and tilts it a little.
    const EL_MIN = THREE.MathUtils.degToRad(6);
    const EL_MAX = THREE.MathUtils.degToRad(48);
    let drag: { x: number; y: number } | null = null;
    const turn = (dAz: number, dEl: number) => {
      base.az += dAz;
      base.el = THREE.MathUtils.clamp(base.el + dEl, EL_MIN, EL_MAX);
      look.toAz = base.az;
      look.toEl = base.el;
      if (still) { look.az = base.az; look.el = base.el; draw(); }
    };
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const onUp = (e: PointerEvent) => {
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = "grab";
    };
    const onKey = (e: KeyboardEvent) => {
      const step = THREE.MathUtils.degToRad(15);
      const map: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step / 3], ArrowDown: [0, -step / 3] };
      const m = map[e.key];
      if (!m) return;
      e.preventDefault();
      turn(rtl && m[0] ? -m[0] : m[0], m[1]);
    };
    el.style.cursor = "grab";
    el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("keydown", onKey);

    // Pointer: a small turn of the camera, and the hovered ward lights up.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered = "";
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (drag) {
        turn(-(e.clientX - drag.x) * 0.009, (e.clientY - drag.y) * 0.004);
        drag = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!still) {
        look.toAz = base.az + nx * THREE.MathUtils.degToRad(7);
        look.toEl = base.el - ny * THREE.MathUtils.degToRad(3);
      }
      ndc.set(nx, -ny);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(windows)[0];
      const key = hit?.instanceId !== undefined ? wins[hit.instanceId].key : "";
      if (key && key !== hovered) {
        wins.forEach((w) => { if (w.key === key) w.target = 1; });
        if (still) { wins.forEach((w) => { w.level = w.target; }); paint(); draw(); }
      }
      hovered = key;
    };
    el.addEventListener("pointermove", onMove);

    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();

    let raf = 0;
    let last = performance.now();
    let nextFlip = last + 700;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now > nextFlip) {
        // Staff come and go: a few windows change, keeping the shift's share lit.
        share = litShare(new Date().getHours());
        for (let k = 0; k < 3; k++) {
          const w = wins[Math.floor(Math.random() * wins.length)];
          if (w.key !== hovered) w.target = Math.random() < share ? 1 : 0;
        }
        nextFlip = now + 500 + Math.random() * 700;
      }
      let changed = false;
      for (const w of wins) {
        if (w.level !== w.target) {
          const d = w.target - w.level;
          w.level = Math.abs(d) < 0.01 ? w.target : w.level + d * Math.min(1, dt * 3);
          changed = true;
        }
      }
      if (changed) paint();
      look.az += (look.toAz - look.az) * Math.min(1, dt * 3);
      look.el += (look.toEl - look.el) * Math.min(1, dt * 3);
      draw();
      raf = requestAnimationFrame(tick);
    };
    if (!still) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("keydown", onKey);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [rtl]);

  return <div ref={host} className={className} tabIndex={0} role="img" aria-label={label} />;
}
