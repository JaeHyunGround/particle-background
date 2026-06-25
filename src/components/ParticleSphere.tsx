import { useMemo, useRef, useLayoutEffect, type MutableRefObject } from "react";
import {
  useFrame,
  useThree,
  extend,
  type MaterialNode,
} from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import gsap from "gsap";
import * as THREE from "three";

/**
 * ParticleSphere — curl noise 흐름 필드 파티클 구체 (내부 구현, 기술 기반 네이밍)
 *
 * THREE.Points + BufferGeometry로 수만 개 입자를 구 표면에 균등 분포시키고,
 * 커스텀 ShaderMaterial의 vertex shader에서 GPU로 curl noise 변위를 계산한다.
 * CPU(JS)에서 입자별 루프는 돌지 않는다 — 기준 위치(aBase)만 마운트 시 1회 생성.
 */

// 포인터 상태: window 리스너(ParticleBackground)가 쓰고 useFrame이 읽는 공유 ref.
export interface PointerState {
  ndc: THREE.Vector2; // 현재 포인터 NDC 좌표(-1~1)
  active: boolean; // 포인터가 브라우저 창 안에 있는지 (호버 = 반응)
}

// ────────────────────────────────────────────────────────────────────────────
// Props (튜닝 파라미터). 모두 ParticleBackground에서 기본값과 함께 내려온다.
// ────────────────────────────────────────────────────────────────────────────
export interface ParticleSphereProps {
  count: number; // 입자 개수
  radius: number; // 구 반지름
  noiseFreq: number; // 노이즈 샘플링 주파수 (클수록 잘게 소용돌이)
  noiseAmp: number; // curl 변위 강도 (GSAP 등장 연출의 목표값)
  flowSpeed: number; // 시간에 따른 흐름 속도
  pointSize: number; // 점 기본 크기 (원근 감쇠 적용 전)
  sphericity: number; // 구 형태 유지 정도 (1=완벽한 구, 0=자유 curl 구름)
  mouseRadius: number; // 마우스 반발 영향 반경
  mousePush: number; // 마우스 반발 세기
  pointer: MutableRefObject<PointerState>; // 공유 포인터 상태 ref
  introDuration?: number; // 등장 연출 길이(초). 기본 1.5
}

// ────────────────────────────────────────────────────────────────────────────
// GLSL: 3D simplex noise (Ashima/Stefan Gustavson) — curl noise의 기반 함수
// ────────────────────────────────────────────────────────────────────────────
const glslSimplexNoise = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    // Permutations
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    // Gradients
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    // Normalise gradients
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    // Mix final noise value
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// GLSL: curl noise — 노이즈 벡터장의 회전(curl)을 유한차분으로 계산.
//   발산이 0인 무발산 흐름이라 입자가 뭉치지 않고 띠(sheet)를 그리며 흐른다.
// ────────────────────────────────────────────────────────────────────────────
const glslCurlNoise = /* glsl */ `
  // 서로 다른 오프셋으로 3개의 노이즈를 샘플링해 벡터 포텐셜을 만든다.
  vec3 snoiseVec3(vec3 x){
    float s  = snoise(x);
    float s1 = snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2));
    float s2 = snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4));
    return vec3(s, s1, s2);
  }

  vec3 curlNoise(vec3 p){
    const float e = 0.1; // 유한차분 스텝
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);

    vec3 px0 = snoiseVec3(p - dx);
    vec3 px1 = snoiseVec3(p + dx);
    vec3 py0 = snoiseVec3(p - dy);
    vec3 py1 = snoiseVec3(p + dy);
    vec3 pz0 = snoiseVec3(p - dz);
    vec3 pz1 = snoiseVec3(p + dz);

    float x = (py1.z - py0.z) - (pz1.y - pz0.y);
    float y = (pz1.x - pz0.x) - (px1.z - px0.z);
    float z = (px1.y - px0.y) - (py1.x - py0.x);

    const float divisor = 1.0 / (2.0 * e);
    return normalize(vec3(x, y, z) * divisor);
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// Vertex shader
// ────────────────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */ `
  uniform float uTime;        // 누적 시간 — 흐름 필드를 시간축으로 이동
  uniform float uNoiseFreq;   // 노이즈 주파수
  uniform float uNoiseAmp;    // curl 변위 강도 (등장 연출로 0→목표값)
  uniform float uFlowSpeed;   // 흐름 속도
  uniform float uPointSize;   // 점 기본 크기
  uniform float uPixelRatio;  // 디바이스 픽셀 비율 (gl_PointSize 보정용)
  uniform float uSphericity;  // 구 형태 유지 정도 (1=완벽한 구, 0=자유 curl 구름)

  // ── 2단계: 마우스 인터랙션 유니폼 (화면 공간 게이팅) ──
  uniform vec2  uMouseScreen;    // 마우스 NDC 좌표(-1~1), useFrame에서 부드럽게 추적
  uniform float uAspect;         // 뷰포트 종횡비 (영향범위를 원형으로 보정)
  uniform float uMouseStrength;  // 마우스 영향 강도 0~1 (움직이면↑, 멈추면 0으로 감쇠)
  uniform float uMouseRadius;    // 반발 영향 반경 (화면/NDC 단위)
  uniform float uMousePush;      // 반발 세기 (커서 아래 입자를 옆으로 밀어내는 양)

  attribute vec3 aBase;       // 각 입자의 기준 위치 (피보나치 구 분포)

  ${glslSimplexNoise}
  ${glslCurlNoise}

  void main(){
    // curl noise 흐름에 따른 변위 (상시 ambient). 마우스가 움직이면 uMouseStrength로
    // 전역 난류(흐름 진폭)를 살짝 키운다 — 작은 가중치(MOUSE_TURBULENCE). 멈추면 1.0.
    const float MOUSE_TURBULENCE = 0.1;
    float turbo = 1.0 + uMouseStrength * MOUSE_TURBULENCE;
    vec3 flow = curlNoise(aBase * uNoiseFreq + uTime * uFlowSpeed);
    vec3 displaced = aBase + flow * uNoiseAmp * turbo;

    // 구 형태 유지: 변위된 위치를 다시 구 표면(원래 반지름)으로 투영한다.
    // 이렇게 하면 curl 변위의 '반지름 방향(바깥으로 튀는)' 성분이 제거되고
    // 표면을 따라 미끄러지는 '접선 방향' 흐름만 남아, sheet 밀도(주름)는
    // 유지되면서 실루엣은 깔끔한 구가 된다.
    //   uSphericity=1 → 완벽한 구 / 0 → 자유 curl 구름 / 그 사이는 블렌딩
    float baseRadius = length(aBase);
    vec3 onSphere = normalize(displaced) * baseRadius;
    displaced = mix(displaced, onSphere, uSphericity);

    // 마우스 반발(화면 공간): 커서가 화면에서 '그 아래 있는' 입자를 옆으로 밀어
    // 구멍(void)을 만든다. 입자의 화면 위치(NDC)와 커서 NDC의 2D 거리로 게이팅
    // 하므로 구의 중앙/가장자리 어디든 균일하게 반응한다. 밀려난 입자는 구멍
    // 가장자리에 응축돼 밝은 테두리가 된다.
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vec4 clip = projectionMatrix * mvPosition;
    vec2 pNDC = clip.xy / clip.w;              // 입자의 화면 위치(NDC)
    vec2 sd = pNDC - uMouseScreen;
    sd.x *= uAspect;                           // 종횡비 보정
    float sDist = length(sd);
    // 경계를 노이즈로 흔들어 '완벽한 원 테두리'의 이질감을 없애고 유기적으로 만든다.
    // (천천히 일렁이는 큰 노이즈 → 구멍 가장자리가 물결치듯 자연스럽게 변형)
    float edgeNoise = snoise(vec3(pNDC * 2.0, uTime * 0.35));
    float r = uMouseRadius * (1.0 + 0.4 * edgeNoise);
    float falloff = smoothstep(r, 0.0, sDist);
    vec2 dir = sd / max(sDist, 1e-4);          // sDist=0 근처 NaN 방지(epsilon)
    // 반발(radial) + 약한 소용돌이(tangential) → 입자가 테두리에 정렬되지 않고
    // 휘돌며 흐른다 → 딱딱한 원형 띠 대신 자연스러운 가장자리
    vec2 swirl = vec2(-dir.y, dir.x);
    vec2 push2 = (dir + swirl * 0.6) * falloff * uMousePush * uMouseStrength;
    mvPosition.xy += push2;

    gl_Position = projectionMatrix * mvPosition;

    // 점 크기 = 기준 크기 × DPR 보정 × 원근 감쇠(멀수록 작게).
    // POINT_SCALE: 카메라 z≈3에서 uPointSize≈1.5가 화면상 ~3px의 섬세한
    // 점이 되도록 잡은 기준 상수. (값이 너무 크면 점들이 포화되어 흰 덩어리가 됨)
    // gl_PointSize는 물리 픽셀 단위라 uPixelRatio로 보정해 레티나에서도 동일 크기 유지.
    const float POINT_SCALE = 4.0;
    gl_PointSize = uPointSize * uPixelRatio * (POINT_SCALE / -mvPosition.z);
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// Fragment shader — gl_PointCoord 기준 radial smoothstep으로 부드러운 흰 점
// ────────────────────────────────────────────────────────────────────────────
const fragmentShader = /* glsl */ `
  uniform float uOpacity; // 등장 연출용 전체 알파 (0→1 페이드인)

  void main(){
    // 점 중심으로부터의 거리 (0=중심, 0.5=가장자리)
    float dist = length(gl_PointCoord - vec2(0.5));
    // 가장자리로 갈수록 알파 감쇠 → 부드러운 원형
    float alpha = smoothstep(0.5, 0.0, dist);
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(vec3(1.0), alpha * uOpacity);
  }
`;

// ────────────────────────────────────────────────────────────────────────────
// drei shaderMaterial 헬퍼로 머티리얼 클래스 생성 + 유니폼 기본값
// ────────────────────────────────────────────────────────────────────────────
const ParticleSphereMaterial = shaderMaterial(
  {
    uTime: 0,
    uNoiseFreq: 1.2,
    uNoiseAmp: 0, // 등장 연출 시작값 0 (GSAP가 목표값으로 트윈)
    uFlowSpeed: 0.15,
    uPointSize: 1.5,
    uPixelRatio: 1, // 컴포넌트 마운트 시 실제 렌더러 DPR로 갱신
    uSphericity: 1, // 구 형태 유지 정도 (1=완벽한 구)
    uOpacity: 0, // 페이드인 시작값 0
    uMouseScreen: new THREE.Vector2(0, 0), // 마우스 NDC (매 프레임 추적)
    uAspect: 1, // 뷰포트 종횡비 (컴포넌트에서 갱신)
    uMouseStrength: 0, // 마우스 영향 강도 0~1 (움직이면↑, 멈추면 0)
    uMouseRadius: 0.45, // 반발 영향 반경(NDC) — 커서 주변 구멍 크기
    uMousePush: 0.4, // 반발 세기 (커서 아래 입자를 옆으로 밀어내는 양)
  },
  vertexShader,
  fragmentShader,
);

extend({ ParticleSphereMaterial });

// JSX 인트린식 타입 등록 (커스텀 머티리얼, R3F v8 방식)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      particleSphereMaterial: MaterialNode<
        THREE.ShaderMaterial,
        typeof ParticleSphereMaterial
      >;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────────────────────
export function ParticleSphere({
  count,
  radius,
  noiseFreq,
  noiseAmp,
  flowSpeed,
  pointSize,
  sphericity,
  mouseRadius,
  mousePush,
  pointer,
  introDuration = 1.5, // 등장 연출 길이(초)
}: ParticleSphereProps) {
  const materialRef = useRef<
    THREE.ShaderMaterial & {
      uniforms: Record<string, THREE.IUniform>;
    }
  >(null);

  // 실제 렌더러의 DPR (gl_PointSize 보정용)
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());
  // 뷰포트 크기 (종횡비 계산용 — 영향범위를 원형으로 보정)
  const size = useThree((s) => s.size);

  // 부드럽게 추적하는 마우스 NDC (매 프레임 pointer 쪽으로 lerp)
  const smoothMouse = useMemo(() => new THREE.Vector2(0, 0), []);

  // aBase: 피보나치 구 분포로 구 표면에 균등 분포한 기준 위치 (마운트 시 1회).
  //
  // ── [질감 토글] JITTER_RATIO ─────────────────────────────────────────────
  //   0.0  → 완벽한 나선 격자 그대로. curl 변위 시 또렷한 sheet/결 질감.
  //          ※ 현재 선택.
  //   0.04 → 각 입자에 작은 랜덤 지터를 더해 격자를 흐트러뜨림 → 부드러운 먼지
  //          (dusty) 그레인. 빗살(moiré)은 사라지고 마우스 구멍 경계도 더 부드럽다.
  //   ※ '먼지 질감'으로 바꾸려면 아래 값을 0.04 로 바꾸면 된다.
  const JITTER_RATIO = 0.04;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5)); // 황금각
    const jitter = JITTER_RATIO * radius; // 0이면 지터 없음(격자 그대로)
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2; // y: 1 → -1
      const r = Math.sqrt(1 - y * y); // 해당 y에서의 반지름
      const theta = golden * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      arr[i * 3 + 0] = x * radius + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 1] = y * radius + (Math.random() - 0.5) * jitter;
      arr[i * 3 + 2] = z * radius + (Math.random() - 0.5) * jitter;
    }
    return arr;
  }, [count, radius]);

  // 매 프레임: 시간 누적(상시 흐름) + 마우스 추적/세기 갱신
  useFrame((_, delta) => {
    const mat = materialRef.current;
    if (!mat) return;

    // 1) 상시 흐름(ambient) — 마우스와 무관하게 항상 전진
    mat.uniforms.uTime.value += delta;

    const ps = pointer.current;

    // 2) 마우스 화면 좌표 추적: 포인터 NDC를 향해 부드럽게 lerp(관성).
    //    프레임레이트 무관(초당 수렴속도 6을 delta로 환산). 종횡비도 매 프레임 갱신.
    smoothMouse.lerp(ps.ndc, 1 - Math.exp(-6 * delta));
    (mat.uniforms.uMouseScreen.value as THREE.Vector2).copy(smoothMouse);
    mat.uniforms.uAspect.value = size.width / size.height;

    // 3) uMouseStrength: 호버(active) 중이면 1로 램프업, 창 밖으로 나가면 0으로
    //    감쇠. 들어올 때는 빠르게(rate 8), 나갈 때는 천천히(rate 3) 수렴해서
    //    마우스를 올려두면 강하게 반응하고, 빼면 ~1.5초에 걸쳐 잔잔해진다.
    //    delta 기반이라 프레임레이트가 달라도 체감 속도가 동일하다.
    const target = ps.active ? 1 : 0;
    const rate = ps.active ? 8 : 3; // 초당 수렴 속도
    const k = 1 - Math.exp(-rate * delta);
    const cur = mat.uniforms.uMouseStrength.value as number;
    mat.uniforms.uMouseStrength.value = THREE.MathUtils.lerp(cur, target, k);
  });

  // GSAP 등장 타임라인: uNoiseAmp 0→목표, uOpacity 0→1.
  // useLayoutEffect로 첫 페인트 전에 시작값(0)을 보장.
  useLayoutEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    // props 변경에 대비해 정적 유니폼들도 동기화
    mat.uniforms.uNoiseFreq.value = noiseFreq;
    mat.uniforms.uFlowSpeed.value = flowSpeed;
    mat.uniforms.uPointSize.value = pointSize;
    mat.uniforms.uPixelRatio.value = pixelRatio;
    mat.uniforms.uSphericity.value = sphericity;
    mat.uniforms.uMouseRadius.value = mouseRadius;
    mat.uniforms.uMousePush.value = mousePush;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.to(mat.uniforms.uNoiseAmp, {
        value: noiseAmp,
        duration: introDuration,
        ease: "power2.out",
      }).to(
        mat.uniforms.uOpacity,
        { value: 1, duration: introDuration, ease: "power2.out" },
        0, // 동시에 시작
      );
    });

    // 언마운트 시 GSAP 트윈/컨텍스트 정리
    return () => ctx.revert();
  }, [
    noiseAmp,
    noiseFreq,
    flowSpeed,
    pointSize,
    sphericity,
    mouseRadius,
    mousePush,
    introDuration,
    pixelRatio,
  ]);

  // 참고: geometry/material은 JSX로 선언적으로 생성했으므로 언마운트 시
  // R3F가 자동으로 dispose 한다. 여기서 수동 dispose를 하면 React StrictMode의
  // 마운트→가짜 언마운트→재마운트 과정에서 이미 dispose된 객체가 재사용되어
  // 아무것도 렌더되지 않으므로(검정 화면), 수동 dispose는 두지 않는다.

  return (
    // frustumCulled=false: 변위로 입자가 바운딩 박스를 벗어나도 컬링되지 않게
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-aBase" args={[positions, 3]} />
        {/* THREE.Points는 position 속성을 요구 — aBase와 동일 버퍼 재사용 */}
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <particleSphereMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
