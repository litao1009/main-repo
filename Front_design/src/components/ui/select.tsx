"use client"

import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  children: React.ReactNode
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
}

function collectOptions(children: React.ReactNode): Array<{ value: string; label: React.ReactNode }> {
  const options: Array<{ value: string; label: React.ReactNode }> = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<SelectItemProps>(child)) return
    options.push({ value: child.props.value, label: child.props.children })
  })
  return options
}

export function Select({ value, onValueChange, placeholder, className, disabled, children }: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const options = React.useMemo(() => collectOptions(children), [children])
  const selected = options.find((o) => o.value === value)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2.5 text-sm",
          "transition-colors",
          "focus-visible:outline-none focus-visible:border-orange-400 focus-visible:ring-2 focus-visible:ring-orange-500/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "cursor-pointer",
          className,
        )}
      >
        <span className={cn("truncate text-left", !selected && "text-slate-400")}>
          {selected?.label ?? placeholder ?? "请选择"}
        </span>
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={cn(
            "absolute left-0 right-0 z-50 mt-1 max-h-[340px] overflow-y-auto rounded-lg border border-[#e5e6eb] bg-white py-1 shadow-md",
          )}
        >
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left text-sm outline-none",
                    "hover:bg-slate-50 focus:bg-slate-50",
                    active && "bg-orange-50 font-medium text-orange-700",
                  )}
                  onClick={() => {
                    onValueChange(opt.value)
                    setOpen(false)
                  }}
                >
                  {opt.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function SelectItem(_props: SelectItemProps) {
  return null
}

SelectItem.displayName = "SelectItem"
