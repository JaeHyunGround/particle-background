import { Canvas } from "@react-three/fiber";
import { ParticleSphere } from "./ParticleSphere";

/**
 * ParticleBackground — 외부 노출 컴포넌트 (역할 기반 네이밍)
 *
 * 풀스크린 검정 배경 뒤에 깔리는 파티클 구체. 비주얼은 전부 WebGL 셰이더가
 * 그리므로 여기서는 캔버스를 화면 뒤에 배치하는 일만 한다(인라인 style).
 * 내부 구현은 ParticleSphere에 위임.
 */

// 튜닝 파라미터 (props로 노출, 기본값) — 의미는 ParticleSphereProps 주석 참고
export interface ParticleBackgroundProps {
  count?: number; // 입자 개수
  radius?: number; // 구 반지름
  noiseFreq?: number; // 노이즈 주파수 (잘게/크게 소용돌이)
  noiseAmp?: number; // curl 변위 강도 (등장 연출 목표값)
  flowSpeed?: number; // 흐름 속도
  pointSize?: number; // 점 크기
  sphericity?: number; // 구 형태 유지 정도 (1=완벽한 구, 0=자유 curl 구름)
}

// 풀스크린 배경 래퍼 스타일.
// pointer-events: none — 2단계에서 마우스 인터랙션 추가 시 제거(풀) 예정.
const wrapperStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: -1,
  background: "#000",
  pointerEvents: "none",
};

export function ParticleBackground({
  count = 300000,
  radius = 1.0,
  noiseFreq = 0.8,
  noiseAmp = 0.3,
  flowSpeed = 0.15,
  pointSize = 0.8,
  sphericity = 1.0, // 기본: 완벽한 구 실루엣 유지
}: ParticleBackgroundProps) {
  return (
    <div style={wrapperStyle}>
      {/* dpr [1,2]: 레티나 품질 + 과도한 픽셀 부하 방지. 카메라 z≈3. */}
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 3], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#000000"]} />
        <ParticleSphere
          count={count}
          radius={radius}
          noiseFreq={noiseFreq}
          noiseAmp={noiseAmp}
          flowSpeed={flowSpeed}
          pointSize={pointSize}
          sphericity={sphericity}
        />
      </Canvas>
    </div>
  );
}

export default ParticleBackground;
