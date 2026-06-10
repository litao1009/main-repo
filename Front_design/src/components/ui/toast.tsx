"use client"

import { Toaster as Sonner } from "sonner"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"

export { toast } from "sonner"

export function showToast(msg: string) {
  const { toast } = require("sonner")
  toast.error(msg)
}

export function ToastContainer() {
  return (
    <Sonner
      position="top-center"
      icons={{
        error: <AlertCircle className="h-[18px] w-[18px] shrink-0 text-red-500" strokeWidth={2.25} />,
        success: <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-slate-900" strokeWidth={2.25} />,
        info: <Info className="h-[18px] w-[18px] shrink-0 text-slate-900" strokeWidth={2.25} />,
        warning: <AlertCircle className="h-[18px] w-[18px] shrink-0 text-amber-500" strokeWidth={2.25} />,
      }}
      toastOptions={{
        style: {
          background: "#ffffff",
          border: "1px solid #e5e6eb",
          color: "#1d2129",
          borderRadius: "8px",
          fontSize: "14px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        },
        classNames: {
          error: "border-red-200",
        },
      }}
    />
  )
}
