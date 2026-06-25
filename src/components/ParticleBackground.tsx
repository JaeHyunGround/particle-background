import { useRef, useEffect, useState, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSphere, type PointerState } from "./ParticleSphere";

/**
 * ParticleBackground — 외부 노출 컴포넌트 (역할 기반 네이밍)
 *
 * 풀스크린 검정 배경 뒤에 깔리는 파티클 구체. 비주얼은 전부 WebGL 셰이더가
 * 그리므로 여기서는 캔버스를 화면 뒤에 배치하고, 포인터 좌표만 수집해
 * 내부 구현(ParticleSphere)에 넘긴다.
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
  mouseRadius?: number; // 마우스 반발 영향 반경 (이 반경 안 입자만 휘저어짐)
  mousePush?: number; // 마우스 반발 세기 (입자를 바깥으로 밀어내는 양)
}

// 풀스크린 배경 래퍼 스타일.
// pointer-events: none 이어도 포인터는 window 리스너로 받으므로(아래 useEffect)
// 실제 콘텐츠 위에 깔 때 클릭을 막지 않으면서도 마우스 인터랙션이 동작한다.
const wrapperStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: -1,
  background: "#000",
  pointerEvents: "none",
};

export function ParticleBackground({
  count,
  radius = 1.0,
  noiseFreq = 0.8,
  noiseAmp = 0.2,
  flowSpeed = 0.15,
  pointSize = 1.0,
  sphericity = 1.0, // 기본: 완벽한 구 실루엣 유지
  mouseRadius = 0.3,
  mousePush = 0.4,
}: ParticleBackgroundProps) {
  // 포인터 상태(좌표/활성)를 ref로 공유 — window 리스너가 쓰고 useFrame이 읽는다.
  // ref라서 값이 바뀌어도 리렌더가 발생하지 않아 매 프레임 갱신에 적합.
  const pointer = useRef<PointerState>({
    ndc: new THREE.Vector2(0, 0),
    active: false,
  });

  // 터치(모바일/태블릿) 감지: hover가 없으므로 마우스 이펙트를 생략하고,
  // 약한 GPU에 맞춰 입자 수와 DPR을 낮춘다. (count를 직접 넘기면 그 값을 우선)
  const isTouch = useMemo(
    () => window.matchMedia("(hover: none), (pointer: coarse)").matches,
    [],
  );
  const resolvedCount = count ?? (isTouch ? 120000 : 220000);
  const maxDpr = isTouch ? 1.25 : 1.5;

  // window 전역 포인터 리스너: 래퍼가 z-index:-1 / pointer-events:none 이어도
  // 마우스 좌표를 확실히 받기 위해 window에 직접 건다. (좌표 저장만, 연산은 셰이더)
  useEffect(() => {
    if (isTouch) return; // 터치 기기: hover가 없으므로 마우스 이펙트 생략
    const onMove = (e: PointerEvent) => {
      // 화면 좌표 → NDC(-1~1). y는 위가 +가 되도록 뒤집는다.
      pointer.current.ndc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      pointer.current.active = true;
    };
    // 포인터가 문서(브라우저 창) 밖으로 나가면 비활성 → 서서히 잔잔해짐
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) pointer.current.active = false;
    };
    const onBlur = () => {
      pointer.current.active = false;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onBlur);
    };
  }, [isTouch]);

  // 탭이 숨겨지거나 창 포커스가 빠지면 렌더 루프를 멈춰 GPU 작업을 0으로 만든다.
  // (안 보이는 동안 발열/배터리 절약 — 부작용 없는 가장 효과적인 최적화)
  const [active, setActive] = useState(true);
  useEffect(() => {
    const update = () =>
      setActive(document.visibilityState === "visible" && document.hasFocus());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);

  return (
    <div style={wrapperStyle}>
      {/* dpr 상한: 데스크탑 1.5, 모바일 1 (약한 GPU 부하↓). 픽셀=fragment/오버드로우
          비용이라 발열에 직결. 품질 손실은 거의 없음. 카메라 z≈3. */}
      <Canvas
        dpr={[1, maxDpr]}
        frameloop={active ? "always" : "never"}
        camera={{ position: [0, 0, 3], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#000000"]} />
        <ParticleSphere
          count={resolvedCount}
          radius={radius}
          noiseFreq={noiseFreq}
          noiseAmp={noiseAmp}
          flowSpeed={flowSpeed}
          pointSize={pointSize}
          sphericity={sphericity}
          mouseRadius={mouseRadius}
          mousePush={mousePush}
          pointer={pointer}
        />
      </Canvas>
    </div>
  );
}

export default ParticleBackground;
