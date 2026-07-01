import { useRef, useEffect, useState, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSphere, type PointerState } from "./ParticleSphere";

/**
 * FpsMeter — dev 전용 경량 FPS 오버레이.
 * useFrame이 '실제 렌더된 프레임'마다 호출되므로 frameloop="demand"에서도
 * 정상 동작한다(= 캡이 60으로 먹으면 60으로 표시). r3f-perf는 demand에서 측정 불가.
 */
function FpsMeter() {
  const elRef = useRef<HTMLDivElement | null>(null);
  const frames = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const div = document.createElement("div");
    div.style.cssText =
      "position:fixed;top:8px;left:8px;z-index:9999;font:12px/1.4 monospace;" +
      "color:#7CFC00;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:4px;pointer-events:none";
    div.textContent = "-- fps";
    document.body.appendChild(div);
    elRef.current = div;
    return () => div.remove();
  }, []);
  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (last.current === 0) last.current = now;
    const dt = now - last.current;
    if (dt >= 500) {
      const fps = Math.round((frames.current * 1000) / dt);
      if (elRef.current)
        elRef.current.textContent = `${fps} fps (${(1000 / Math.max(fps, 1)).toFixed(1)} ms)`;
      frames.current = 0;
      last.current = now;
    }
  });
  return null;
}

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
  fps?: number; // 렌더 프레임 상한. 미설정=네이티브 최대(120Hz면 120). 발열 줄이려면 60/30 지정
}

// 풀스크린 배경 래퍼 스타일.
// pointer-events: none 이어도 포인터는 window 리스너로 받으므로(아래 useEffect)
// 실제 콘텐츠 위에 깔 때 클릭을 막지 않으면서도 마우스 인터랙션이 동작한다.
const wrapperStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: -1,
  background: "transparent", // iframe 임베드 시 부모 페이지 배경이 비치도록 투명
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
  fps, // 미설정=네이티브 최대 프레임(최상 품질). 줄이려면 60/30 등 지정
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

  // 테마: URL ?theme=light 면 어두운 입자(라이트 페이지용), 아니면 흰 입자(다크 페이지용).
  // 라이트는 일반 알파 블렌딩(어두운 점이 흰 배경 위에 보임), 다크는 가산 블렌딩(글로우).
  const theme = useMemo(
    () => (new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark"),
    [],
  );
  const particleColor = useMemo(
    () => (theme === "light" ? new THREE.Color(0.11, 0.11, 0.13) : new THREE.Color(1, 1, 1)),
    [theme],
  );
  const additive = theme === "dark";

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

  // iframe 임베드용: 부모 페이지가 pointer-events:none 로 이 iframe을 덮어도
  // 자체 pointermove는 발생하지 않는다. 그래서 부모가 postMessage로 넘겨주는
  // NDC 좌표({ type:'sky-pointer', ndcX, ndcY, active })를 받아 포인터 상태에 반영한다.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // cross-origin 임베드(스벤/함 등 다른 오리진)에서 좌표를 받으므로 origin 제한 없음.
      // 페이로드는 포인터 좌표뿐이라 위험이 낮고, type 가드로만 필터한다.
      const d = e.data;
      if (!d || d.type !== "sky-pointer") return;
      if (typeof d.ndcX === "number" && typeof d.ndcY === "number") {
        pointer.current.ndc.set(d.ndcX, d.ndcY);
      }
      pointer.current.active = !!d.active;
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // '실제로 보일 때만' 렌더 루프를 돌려 GPU 작업을 아낀다(안 보이면 정지).
  //   - visibilitychange: 탭이 숨겨지면 정지 (iframe도 부모 탭 따라감)
  //   - IntersectionObserver: 캔버스가 화면 밖(스크롤 아웃)이면 정지
  // document.hasFocus()는 쓰지 않는다 — iframe 안에선 보통 false라 멀쩡히 보여도
  // 멈춰버린다. '보이는지' 기준이라야 iframe 임베드에서도 정상 동작한다.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    let tabVisible = document.visibilityState === "visible";
    let inView = true;
    const apply = () => setActive(tabVisible && inView);

    const onVis = () => {
      tabVisible = document.visibilityState === "visible";
      apply();
    };
    document.addEventListener("visibilitychange", onVis);

    let io: IntersectionObserver | undefined;
    const el = wrapperRef.current;
    if (el && "IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          inView = entries[0]?.isIntersecting ?? true;
          apply();
        },
        { threshold: 0 },
      );
      io.observe(el);
    }
    apply();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} style={wrapperStyle}>
      {/* dpr 상한: 데스크탑 1.5, 모바일 1 (약한 GPU 부하↓). 픽셀=fragment/오버드로우
          비용이라 발열에 직결. 품질 손실은 거의 없음. 카메라 z≈3. */}
      {/* frameloop: 활성 시 — fps 미설정이면 always(네이티브 최대 프레임=최상 품질),
          fps 설정이면 demand(ParticleSphere가 그 상한으로 invalidate).
          비활성(탭 숨김/화면 밖) 시 never로 완전 정지. */}
      <Canvas
        dpr={[1, maxDpr]}
        frameloop={active ? (fps != null ? "demand" : "always") : "never"}
        camera={{ position: [0, 0, 3], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        {/* 개발 모드에서만 FPS 오버레이 (프로덕션 빌드 제외). 발열/GPU 전력은 powermetrics로 */}
        {import.meta.env.DEV && <FpsMeter />}
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
          color={particleColor}
          additive={additive}
          fps={fps}
          pointer={pointer}
        />
      </Canvas>
    </div>
  );
}

export default ParticleBackground;
