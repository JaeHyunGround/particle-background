import { ParticleBackground } from './components/ParticleBackground'

/**
 * 풀스크린 검정 데모 페이지.
 * ParticleBackground가 fixed/z-index -1로 화면 뒤에 깔리므로,
 * 여기서는 기본값으로 한 번 렌더링하기만 하면 된다.
 */
export default function App() {
  return <ParticleBackground />
}
