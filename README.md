# Particle Background

Three.js(React Three Fiber) **curl noise 흐름 필드 파티클 구체**.
검은 배경에 수만 개의 흰 점이 구 형태로 모여 curl noise 흐름을 따라 흐르며
밝은 주름(sheet) 띠를 만드는 X-ray 풍 풀스크린 배경.

> **1단계** — 상시 흐름 + 등장 연출. 마우스 인터랙션 없음.
> `uMouse(vec3)` / `uMouseStrength(float)` 유니폼은 2단계용으로 선언만 되어 있고
> 이번 단계엔 0으로 고정되어 동작에 영향이 없습니다.

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
  count={350000}     // 입자 수 (밀도). 저사양이면 낮추기
  radius={1.0}
  noiseFreq={0.65}   // 작을수록 크고 부드러운 주름
  noiseAmp={0.2}     // 클수록 변위 큼(너무 크면 구가 깨짐)
  flowSpeed={0.15}
  pointSize={1.0}    // 점 크기 (크면 milky하게 뭉침)
/>
```

## 핵심

- **GPU 전용 변위**: vertex shader에서 3D simplex noise → curl noise(유한차분)
  계산. CPU 입자 루프 없음. 기준 위치 `aBase`만 피보나치 구 분포로 1회 생성.
- **렌더링**: `THREE.Points` + AdditiveBlending, `depthWrite/Test=false`,
  `frustumCulled=false`. fragment에서 `gl_PointCoord` radial smoothstep으로 부드러운 점.
- **등장 연출**: GSAP 타임라인으로 `uNoiseAmp` 0→목표, `uOpacity` 0→1 (~1.5초).
  언마운트 시 GSAP 컨텍스트 revert + geometry/material dispose.
