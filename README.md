# Particle Background

Three.js(React Three Fiber) **curl noise 흐름 필드 파티클 구체**.
검은 배경에 수만 개의 흰 점이 구 형태로 모여 curl noise 흐름을 따라 흐르며
밝은 주름(sheet) 띠를 만드는 X-ray 풍 풀스크린 배경.

> **2단계 완료** — 상시 흐름 + 등장 연출 + **마우스 인터랙션(호버 기반)**.
> 커서를 화면에 올려두면(움직이지 않아도) 그 위치에 부드러운 **dent(움푹 패임)**가
> 생겨 커서를 따라다닌다. 나머지 구는 조밀한 먼지 그레인을 유지하며, 커서가
> 브라우저 창을 벗어나면 `uMouseStrength`가 ~1.5초에 걸쳐 0으로 감쇠해 1단계의
> 잔잔한 상태로 돌아온다. 상시 흐름(ambient)은 마우스와 무관하게 항상 살아 있다.

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
  mouseRadius={1.0}  // 마우스 dent 크기(영향 반경)
  mousePush={0.5}    // 마우스 dent 깊이(반발 세기)
/>
```

## 핵심

- **GPU 전용 변위**: vertex shader에서 3D simplex noise → curl noise(유한차분)
  계산. CPU 입자 루프 없음. 기준 위치 `aBase`만 피보나치 구 분포로 1회 생성.
  완벽한 나선 격자는 변위 시 빗살(moiré)을 만들므로 각 입자에 작은 랜덤
  지터(`0.04*radius`)를 더해 부드러운 먼지(dusty) 그레인으로 만든다.
- **렌더링**: `THREE.Points` + AdditiveBlending, `depthWrite/Test=false`,
  `frustumCulled=false`. fragment에서 `gl_PointCoord` radial smoothstep으로 부드러운 점.
- **등장 연출**: GSAP 타임라인으로 `uNoiseAmp` 0→목표, `uOpacity` 0→1 (~1.5초).
  언마운트 시 GSAP 컨텍스트 revert + geometry/material dispose.
- **마우스 인터랙션(2단계)**: `window` 포인터 리스너에서 NDC만 저장(래퍼가
  `z-index:-1`/`pointer-events:none`이라 window에 직접 건다). `useFrame`에서
  `Raycaster`로 구 중심 평면에 투영해 `uMouse`를 추적하고, 호버 중이면
  `uMouseStrength`를 1로, 창을 벗어나면 0으로 **delta 기반(프레임레이트 무관)**
  보간한다. vertex shader에서 `uMouse` 반발 push(`smoothstep` 반경 감쇠 + epsilon
  가드) + 전역 난류 부스트를 기존 curl 변위에 더한다. 무거운 연산은 전부 셰이더에서 처리.
