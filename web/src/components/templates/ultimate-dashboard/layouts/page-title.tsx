// Adapted from PaceUI Ultimate Dashboard page-title.
import type { ReactNode } from 'react';
export const PageTitle = ({title,endContent,description}:{title:string;endContent?:ReactNode;description?:string}) =>
 <div className="flex flex-wrap items-center justify-between gap-4">
  <div><h1 className="text-lg font-medium sm:text-xl">{title}</h1>{description&&<p className="text-muted-foreground mt-1 text-sm">{description}</p>}</div>
  {endContent}
 </div>;
