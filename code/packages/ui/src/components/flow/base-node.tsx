/*
 * Node blocks in the shape of shadcn's React Flow UI components (BaseNode, BaseHandle,
 * LabeledGroupNode), adapted to this app's palette: a card with a header, content and footer,
 * small handles, and a labeled frame for groups.
 */
import { forwardRef, type HTMLAttributes } from "react";
import { Handle, type HandleProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const BaseNode = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "base-node relative flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs transition-[box-shadow,opacity,border-color]",
      className,
    )}
    tabIndex={-1}
    {...props}
  />
));
BaseNode.displayName = "BaseNode";

export const BaseNodeHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <header ref={ref} className={cn("flex min-w-0 items-center gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-medium", className)} {...props} />
));
BaseNodeHeader.displayName = "BaseNodeHeader";

export const BaseNodeHeaderTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("min-w-0 flex-1 truncate font-semibold uppercase tracking-wide", className)} {...props} />
));
BaseNodeHeaderTitle.displayName = "BaseNodeHeaderTitle";

export const BaseNodeContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("min-h-0 flex-1 px-2.5 text-[13px] leading-snug", className)} {...props} />
));
BaseNodeContent.displayName = "BaseNodeContent";

export const BaseNodeFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-2.5 border-t border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums", className)} {...props} />
));
BaseNodeFooter.displayName = "BaseNodeFooter";

export const BaseHandle = forwardRef<HTMLDivElement, HandleProps>(({ className, ...props }, ref) => (
  <Handle ref={ref} className={cn("base-handle !h-2 !w-2 !min-w-0 !rounded-full !border !border-border !bg-card", className)} {...props} />
));
BaseHandle.displayName = "BaseHandle";

/** A frame with its label on a tab at the top-left, for phases and subagent runs. */
export function LabeledGroupNode({ label, icon, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; icon?: React.ReactNode }) {
  return (
    <div className={cn("labeled-group h-full w-full rounded-xl border border-dashed", className)} {...props}>
      <div className="labeled-group-tab inline-flex max-w-[calc(100%-12px)] items-center gap-1.5 rounded-br-lg rounded-tl-xl px-2.5 py-1 text-[11.5px] font-semibold">
        {icon}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}
