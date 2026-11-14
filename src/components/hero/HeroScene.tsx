import { Environment, Float, Lightformer, Sparkles } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

function usePointerDrift() {
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return pointer;
}

function Core() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.35;
    ref.current.rotation.x += delta * 0.12;
  });

  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[0.42, 1]} />
      <meshBasicMaterial color="#00F5D4" wireframe transparent opacity={0.35} />
    </mesh>
  );
}

function Sculpture() {
  const group = useRef<THREE.Group>(null);
  const pointer = usePointerDrift();

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    node.rotation.y = THREE.MathUtils.damp(node.rotation.y, pointer.current.x * 0.45, 3, delta);
    node.rotation.x = THREE.MathUtils.damp(node.rotation.x, pointer.current.y * 0.28, 3, delta);
  });

  return (
    <group ref={group}>
      <Float speed={1.25} rotationIntensity={0.32} floatIntensity={0.9}>
        <mesh rotation={[0.45, 0.55, 0.2]}>
          <torusKnotGeometry args={[1.02, 0.32, 240, 36]} />
          <meshPhysicalMaterial
            color="#d7ecff"
            metalness={1}
            roughness={0.16}
            envMapIntensity={2.1}
            clearcoat={1}
            clearcoatRoughness={0.14}
            iridescence={0.45}
            iridescenceIOR={1.3}
            iridescenceThicknessRange={[140, 520]}
          />
        </mesh>
      </Float>

      <mesh rotation={[Math.PI / 2.15, 0.15, 0.3]}>
        <torusGeometry args={[1.95, 0.012, 16, 128]} />
        <meshBasicMaterial color="#7B61FF" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 1.72, -0.35, -0.2]}>
        <torusGeometry args={[2.22, 0.008, 16, 144]} />
        <meshBasicMaterial color="#00F5D4" transparent opacity={0.38} />
      </mesh>

      <Core />

      <Float speed={2.1} rotationIntensity={0} floatIntensity={2.2}>
        <mesh position={[1.85, 0.95, 0.35]}>
          <sphereGeometry args={[0.13, 32, 32]} />
          <meshStandardMaterial color="#F5C451" metalness={1} roughness={0.18} />
        </mesh>
      </Float>
      <Float speed={1.7} rotationIntensity={0} floatIntensity={2.6}>
        <mesh position={[-1.95, -0.85, 0.5]}>
          <sphereGeometry args={[0.09, 32, 32]} />
          <meshStandardMaterial color="#7B61FF" metalness={0.9} roughness={0.22} />
        </mesh>
      </Float>

      <Sparkles count={34} scale={4.4} size={2.1} speed={0.32} color="#9ffff2" opacity={0.55} />
    </group>
  );
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    onReady();
  });
  return null;
}

export default function HeroScene({
  active,
  onReady,
}: {
  active: boolean;
  onReady: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7], fov: 38 }}
      frameloop={active ? "always" : "never"}
      gl={{ alpha: true, antialias: false, powerPreference: "default" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-hidden="true"
    >
      <FirstFrame onReady={onReady} />
      <ambientLight intensity={0.55} />
      <spotLight position={[6, 6, 6]} angle={0.5} penumbra={1} intensity={55} color="#00F5D4" />
      <spotLight position={[-6, -3, 5]} angle={0.6} penumbra={1} intensity={42} color="#7B61FF" />
      <pointLight position={[0, 3.5, -4]} intensity={22} color="#F5C451" />

      <Sculpture />

      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.4} color="#00F5D4" position={[0, 3, -3]} scale={[6, 6, 1]} />
        <Lightformer
          intensity={1.8}
          color="#7B61FF"
          position={[-3.5, -1, 2]}
          scale={[4, 4, 1]}
          rotation-y={Math.PI / 2}
        />
        <Lightformer
          intensity={1.5}
          color="#ffffff"
          position={[3.5, 1, 2]}
          scale={[3.5, 3.5, 1]}
          rotation-y={-Math.PI / 2}
        />
      </Environment>
    </Canvas>
  );
}
