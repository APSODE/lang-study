// 아래에서 올라오는 시트(넓은 화면에서는 가운데 대화상자). <dialog> 를 써서 Esc · 바깥 클릭으로 닫는다.
import { type ReactNode, useEffect, useRef } from 'react'
import { Icon } from './Icon.tsx'

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={e => {
        // 바깥(backdrop)을 누르면 닫는다: 클릭 대상이 dialog 자신일 때
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
    >
      <div className="sheet-body">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={() => ref.current?.close()}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
