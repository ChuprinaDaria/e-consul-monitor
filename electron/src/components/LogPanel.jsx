import React, { useEffect, useRef } from 'react'

export default function LogPanel({ lines }) {
  const ref = useRef()
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div
      ref={ref}
      className="bg-gray-900 text-green-400 font-mono text-xs p-3 rounded h-48 overflow-y-auto"
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}
