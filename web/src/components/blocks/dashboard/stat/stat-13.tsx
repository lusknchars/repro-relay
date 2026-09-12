import type { ReactNode } from "react";

import type { LucideIcon } from "lucide-react";
import { ActivityIcon, MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Stat13Props = {
    className?: string;
    icon?: LucideIcon;
    title?: string;
    value?: string | number;
    prefix?: ReactNode;
    suffix?: ReactNode;
    secondaryText?: string;
    trendValue?: string;
    trendDirection?: "up" | "down" | "neutral";
};

export const Stat13 = ({
    className,
    icon: Icon = ActivityIcon,
    title = "Workspace activity",
    value = 0,
    prefix,
    suffix,
    secondaryText = "Recorded in this workspace",
    trendValue = "",
    trendDirection = "up",
}: Stat13Props) => {
    const trendConfig = {
        up: {
            Icon: TrendingUpIcon,
            badgeClass: "text-green-500 border-green-500/20 bg-green-500/10",
        },
        down: {
            Icon: TrendingDownIcon,
            badgeClass: "text-destructive border-destructive/20 bg-destructive/10",
        },
        neutral: {
            Icon: MinusIcon,
            badgeClass: "text-foreground bg-muted",
        },
    };

    const { Icon: TrendIcon, badgeClass } = trendConfig[trendDirection];

    return (
        <Card className={cn("@container/card flex flex-col justify-between gap-3 py-4", className)}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-0">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="bg-muted/40 flex size-8 shrink-0 items-center justify-center rounded-md border">
                        <Icon className="text-foreground size-4" />
                    </div>
                    <CardTitle className="text-muted-foreground truncate text-sm font-medium">{title}</CardTitle>
                </div>
                {trendValue && (
                    <Badge
                        variant="outline"
                        className={cn("shrink-0 gap-1 px-1.5 py-0.5 text-xs font-medium", badgeClass)}>
                        <TrendIcon className="size-3" />
                        {trendValue}
                    </Badge>
                )}
            </CardHeader>
            <CardContent className="flex flex-col gap-1 px-4">
                <div className="text-2xl font-medium tracking-tight">
                    {prefix && <span className="text-muted-foreground me-0.5 align-top text-sm">{prefix}</span>}
                    <span>{value}</span>
                    {suffix && <span className="ms-0.5 text-sm">{suffix}</span>}
                </div>
                <p className="text-muted-foreground line-clamp-1 text-xs leading-normal">{secondaryText}</p>
            </CardContent>
        </Card>
    );
};
