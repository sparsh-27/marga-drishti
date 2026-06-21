import React from "react";
import { Outlet, useLocation, Link } from "react-router-dom";
import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function Layout() {
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                {pathSegments.length === 0 ? (
                  <BreadcrumbItem>
                    <BreadcrumbPage>Dashboard</BreadcrumbPage>
                  </BreadcrumbItem>
                ) : (
                  <>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink render={<Link to="/command-center" />}>
                        Dashboard
                      </BreadcrumbLink>
                    </BreadcrumbItem>

                    {pathSegments.map((segment, index) => {
                      const isLast = index === pathSegments.length - 1;
                      const path = `/${pathSegments.slice(0, index + 1).join("/")}`;
                      const title = segment
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase());

                      return (
                        <React.Fragment key={path}>
                          <BreadcrumbSeparator className="hidden md:block" />
                          <BreadcrumbItem>
                            {isLast ? (
                              <BreadcrumbPage>{title}</BreadcrumbPage>
                            ) : (
                              <BreadcrumbLink render={<Link to={path} className="hidden md:block" />}>
                                {title}
                              </BreadcrumbLink>
                            )}
                          </BreadcrumbItem>
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0 min-w-0 overflow-x-hidden">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
