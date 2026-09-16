import * as React from "react"
import { cn } from "@/lib/utils"

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> {
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (value: number[]) => void
  onChange?: React.ChangeEventHandler<HTMLInputElement>
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, defaultValue = [0], min = 0, max = 100, step = 1, onValueChange, onChange, ...props }, ref) => {
    const currentValue = value ? value[0] : defaultValue[0]
    const percent = ((currentValue - min) / (max - min)) * 100
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange?.([Number(e.target.value)])
      onChange?.(e)
    }
    return (
      <div className={cn("relative flex w-full touch-none select-none items-center", className)}>
        <div className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
          <div className="absolute h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <input ref={ref} type="range" min={min} max={max} step={step} value={currentValue} onChange={handleChange} className="absolute inset-0 w-full cursor-pointer opacity-0" {...props} />
        <div className="pointer-events-none absolute block h-5 w-5 rounded-full border-2 border-primary bg-background shadow" style={{ left: `calc(${percent}% - 10px)` }} />
      </div>
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
