# Particle Background

Three.js(React Three Fiber) **curl noise 흐름 필드 파티클 구체**.
검은 배경에 수만 개의 흰 점이 구 형태로 모여 curl noise 흐름을 따라 흐르며
밝은 주름(sheet) 띠를 만드는 X-ray 풍 풀스크린 배경.

> **2단계 완료** — 상시 흐름 + 등장 연출 + **마우스 인터랙션(호버 기반·화면공간)**.
> 커서를 화면에 올려두면(움직이지 않아도) 그 아래 입자가 옆으로 밀려 **구멍(void)**이
> 패이고 가장자리에 밝은 테두리가 생긴다. 화면공간 게이팅이라 구의 **중앙/가장자리
> 어디든** 균일하게 반응하며 구멍이 커서를 따라다닌다. 커서가 브라우저 창을 벗어나면
> `uMouseStrength`가 ~1.5초에 걸쳐 0으로 감쇠해 1단계의 잔잔한 상태로 돌아온다.
> 상시 흐름(ambient)은 마우스와 무관하게 항상 살아 있다.

## 실행

```bash
pnpm install
pnpm dev      # 개발 서버
pnpm build    # 프로덕션 빌드
```

## 구조

| 파일 | 역할 |
|------|------|
| `src/components/ParticleBackground.tsx` | 외부 노출 컴포넌트(역할 기반). Canvas + 풀스크린 배치 |
| `src/components/ParticleSphere.tsx` | 내부 구현(기술 기반). BufferGeometry + curl noise ShaderMaterial |
| `src/App.tsx` | 풀스크린 검정 데모 |

## 사용

```tsx
import { ParticleBackground } from './components/ParticleBackground'

<ParticleBackground
  count={300000}     // 입자 수 (밀도). 저사양이면 낮추기
  radius={1.0}
  noiseFreq={0.8}    // 작을수록 크고 부드러운 주름
  noiseAmp={0.2}     // 클수록 변위 큼(너무 크면 빗살·흩어짐)
  flowSpeed={0.15}
  pointSize={0.8}    // 점 크기 (크면 milky하게 뭉침)
  sphericity={1.0}   // 1=완벽한 구 실루엣 / 0=자유 curl 구름
  mouseRadius={0.45} // 구멍 크기(화면/NDC 단위 영향 반경)
  mousePush={0.4}    // 구멍 세기(커서 아래 입자를 옆으로 밀어내는 양)
/>
```

## 핵심

- **GPU 전용 변위**: vertex shader에서 3D simplex noise → curl noise(유한차분)
  계산. CPU 입자 루프 없음. 기준 위치 `aBase`만 피보나치 구 분포로 1회 생성.
  입자 질감은 `ParticleSphere.tsx`의 `JITTER_RATIO` 상수로 토글한다 —
  `0.0`(현재)이면 또렷한 sheet/결, `0.04`면 격자를 흐트러 부드러운 먼지(dusty)
  그레인으로 바뀐다.
- **렌더링**: `THREE.Points` + AdditiveBlending, `depthWrite/Test=false`,
  `frustumCulled=false`. fragment에서 `gl_PointCoord` radial smoothstep으로 부드러운 점.
- **등장 연출**: GSAP 타임라인으로 `uNoiseAmp` 0→목표, `uOpacity` 0→1 (~1.5초).
  언마운트 시 GSAP 컨텍스트 revert + geometry/material dispose.
- **마우스 인터랙션(2단계, 화면공간)**: `window` 포인터 리스너에서 NDC만 저장(래퍼가
  `z-index:-1`/`pointer-events:none`이라 window에 직접 건다). `useFrame`에서 그 NDC를
  `uMouseScreen`으로 부드럽게 추적하고, 호버 중이면 `uMouseStrength`를 1로, 창을
  벗어나면 0으로 **delta 기반(프레임레이트 무관)** 보간한다. vertex shader에서 각 입자의
  화면 위치(NDC)와 커서 NDC의 2D 거리로 게이팅해(`uAspect`로 원형 보정) 커서 아래
  입자를 view 공간에서 옆으로 민다 → 구의 중앙/가장자리 무관하게 구멍이 생긴다.
  (평면 투영 방식은 중앙에서 커서가 구 중심에 놓여 효과가 안 나는 문제가 있었음.)
  무거운 연산은 전부 셰이더에서 처리.
