import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all animate-in fade-in slide-in-from-top-2",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
        success:
          "border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-50",
        warning:
          "border-yellow-500 bg-yellow-50 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-50",
        info:
          "border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface ToastProps extends React.ComponentPropsWithoutRef<"div">, VariantProps<typeof toastVariants> {
  title?: string
  description?: string
  onClose?: () => void
}

function Toast({ className, variant, title, description, onClose, ...props }: ToastProps) {
  const iconMap = {
    default: <Info className="h-5 w-5" />,
    destructive: <AlertCircle className="h-5 w-5" />,
    success: <CheckCircle2 className="h-5 w-5" />,
    warning: <AlertTriangle className="h-5 w-5" />,
    info: <Info className="h-5 w-5" />,
  }

  return (
    <div
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <div className="flex items-start gap-3 flex-1">
        <div className="flex-shrink-0">
          {iconMap[variant || "default"]}
        </div>
        <div className="flex-1 space-y-1">
          {title && (
            <div className="text-sm font-semibold">{title}</div>
          )}
          {description && (
            <div className="text-sm opacity-90">{description}</div>
          )}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export { Toast, toastVariants }
