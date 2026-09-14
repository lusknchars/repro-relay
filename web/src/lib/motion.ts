import { useRef, type DependencyList } from 'react'
import gsap from 'gsap'
import { useAppearance } from '../components/reptest/Appearance'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

// State owns visibility and focus. Motion only introduces already-visible content.
export function useTransition<T extends HTMLElement>(dependencies: DependencyList) {
  const ref = useRef<T>(null)
  const { preferences } = useAppearance()
  useGSAP(() => {
    if (!ref.current || !preferences.motion) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(ref.current, { y: 7, opacity: .65 }, {
        y: 0, opacity: 1, duration: .22, ease: 'power2.out',
        clearProps: 'transform,opacity',
      })
    })
    return () => media.revert()
  }, { scope: ref, dependencies: [...dependencies, preferences.motion], revertOnUpdate: true })
  return ref
}
