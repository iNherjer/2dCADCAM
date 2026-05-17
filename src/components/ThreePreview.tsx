import { BoxGeometry, BufferGeometry, Color, DirectionalLight, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { useEffect, useRef } from "react";
import { discretizeEntity } from "../lib/geometry";
import type { AnalysisResult } from "../../shared/schema";

type Props = {
  result: AnalysisResult | null;
};

export function ThreePreview({ result }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new Scene();
    scene.background = new Color("#111820");

    const camera = new PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 0.1, 5000);
    camera.position.set(80, -100, 80);
    camera.lookAt(0, 0, 0);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const light = new DirectionalLight("#ffffff", 2.4);
    light.position.set(60, -80, 120);
    scene.add(light);
    scene.add(buildPreviewGroup(result));

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [result]);

  return (
    <section className="canvas-panel">
      <div className="section-title compact">
        <h2>3D Vorschau</h2>
        <span>Rohteil + Pfade</span>
      </div>
      <div className="three-surface" ref={mountRef} />
    </section>
  );
}

function buildPreviewGroup(result: AnalysisResult | null): Group {
  const group = new Group();
  const stockWidth = Math.max(result?.analysis.bounds?.width ?? 80, 20);
  const stockHeight = Math.max(result?.analysis.bounds?.height ?? 60, 20);
  const stockDepth = result?.camParameters.stockThicknessMm ?? 6;

  const stock = new Mesh(new BoxGeometry(stockWidth, stockHeight, stockDepth), new MeshStandardMaterial({ color: "#35424f", roughness: 0.78, metalness: 0.12, transparent: true, opacity: 0.82 }));
  stock.position.z = -stockDepth / 2;
  group.add(stock);

  const bounds = result?.analysis.bounds;
  if (bounds) {
    group.position.set(-(bounds.minX + bounds.width / 2), -(bounds.minY + bounds.height / 2), 0);
  }

  const lineMaterial = new LineBasicMaterial({ color: "#5eead4" });
  const cutMaterial = new LineBasicMaterial({ color: "#fbbf24" });

  for (const entity of result?.analysis.entities ?? []) {
    const points = discretizeEntity(entity).map((point) => new Vector3(point.x, point.y, 0.4));
    if (points.length > 1) group.add(new Line(new BufferGeometry().setFromPoints(points), lineMaterial));
  }

  for (const operation of result?.toolpaths ?? []) {
    for (const pass of operation.passes) {
      const points = pass.moves.map((move) => new Vector3(move.to.x, move.to.y, move.to.z));
      if (points.length > 1) group.add(new Line(new BufferGeometry().setFromPoints(points), cutMaterial));
    }
  }

  return group;
}
