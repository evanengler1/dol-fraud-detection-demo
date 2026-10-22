import { Skeleton } from "@/components/kit"

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-12 w-[60%]" />
      <Skeleton className="h-5 w-[40%]" />
      <div className="grid grid-cols-4 gap-3 pt-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-80" />
    </div>
  )
}
