import * as React from "react";
import { ChevronsUpDown, Lock, Minus, Plus, Search } from "lucide-react";
import { EventBadge } from "@/components/badges";
import { IdleLock } from "@/components/IdleLock";
import { DisplayMenu } from "@/components/DisplayMenu";
import { ToastHost } from "@/components/ToastHost";
import { Button } from "@/components/ui/primitives";
import { AiAssistant } from "@/components/AiAssistant";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarFooter, SidebarHeader, SidebarItem, SidebarNav, SidebarNested, SidebarSection, SidebarToggle, useSidebar } from "@/components/ui/sidebar";
import { AiGovernancePage } from "@/pages/AiGovernancePage";
import { BedBoardPage } from "@/pages/BedBoardPage";
import { ChartPage } from "@/pages/ChartPage";
import { CompliancePage } from "@/pages/CompliancePage";
import { EmergencyBoard } from "@/pages/EmergencyBoard";
import { EncountersPage } from "@/pages/EncountersPage";
import { AccessPage, AuditPage, ConfidentialPage, RegistrationPage } from "@/pages/GovernancePages";
import { LabWorklistPage } from "@/pages/LabWorklistPage";
import { LogPage } from "@/pages/LogPage";
import { MasterPage } from "@/pages/MasterPage";
import { NphiesClinicalPage } from "@/pages/NphiesClinicalPage";
import { NphiesFinancialPage } from "@/pages/NphiesFinancialPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { PharmacyDispensePage } from "@/pages/PharmacyDispensePage";
import { RadiologyWorklistPage } from "@/pages/RadiologyWorklistPage";
import { RunnerPage } from "@/pages/RunnerPage";
import { ScenarioPage } from "@/pages/ScenarioPage";
import { SpecPage } from "@/pages/SpecPage";
import { WorklistPage } from "@/pages/WorklistPage";

import { setDevMode, useDevMode } from "@/lib/devmode";
import { NAV, type NavGroup, type NavPage } from "@/lib/nav";
import { navigate, useRoute } from "@/lib/router";
import { can, ROLES, switchUser, USERS, lockScreen, useSession } from "@/lib/session";
import { EVENTS, EVENT_BY_ID, type EventId } from "@/lib/spec";
import { useHis } from "@/lib/store";

const SHORT: Record<EventId, string> = {
  A01: "Admit", A02: "Transfer", A03: "Discharge", A04: "Register", A05: "Pre-Admit", A06: "To Inpatient",
  A07: "To Outpatient", A08: "Update Visit", "A08-CNHI": "CNHI Discharge", A11: "Cancel Admit", A12: "Cancel Transfer",
  A13: "Cancel Discharge", A31: "Update Person", A38: "Cancel Pre-Admit", A45: "Move Visit", A50: "Change Visit No.",
};

function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] px-1.5 py-0.5 text-xs font-medium leading-none text-[var(--muted-foreground)] tabular-nums">
      {children}
    </span>
  );
}

function Brand() {
  const { collapsed } = useSidebar();
  if (collapsed) {
    return <img src="/brand/onasi-icon.png" alt="Onasi" className="h-7 w-auto shrink-0 dark:brightness-0 dark:invert" />;
  }
  // ps-7 matches the width of the collapse button on the right, so the logo sits in the true centre.
  return (
    <div className="flex min-w-0 flex-1 justify-center ps-7">
      <img src="/brand/onasi-logo.png" alt="Onasi EMR" className="h-9 w-auto dark:brightness-0 dark:invert" />
    </div>
  );
}

/** The powered-by credit. The logo sits on a white chip so its dark blue text reads in the dark theme too. */
function PoweredBy() {
  const { collapsed } = useSidebar();
  if (collapsed) return null;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span>Powered by</span>
      <span className="rounded-md bg-white px-1.5 py-1 ring-1 ring-border">
        <img src="/brand/ebttikar-logo.png" alt="Ebttikar" className="h-14 w-auto" />
      </span>
      <span className="ms-auto">&copy; {new Date().getFullYear()}</span>
    </div>
  );
}

/** Visible groups for the current user and view. */
function useVisibleNav(): NavGroup[] {
  const dev = useDevMode();
  useSession();
  return NAV.filter((g) => (!g.devOnly || dev) && (!g.perm || can(g.perm)))
    .map((g) =>
      g.id === "dev-adt"
        ? { ...g, pages: EVENTS.map((e) => ({ id: e.id, label: SHORT[e.id], path: `/event/${e.id}` })) }
        : { ...g, pages: g.pages.filter((p) => !p.perm || can(p.perm)) },
    )
    .filter((g) => g.pages.length > 0);
}

function NavTree({ path }: { path: string }) {
  const groups = useVisibleNav();
  const { collapsed } = useSidebar();
  const state = useHis();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set(["opd", "ipd"]));
  const query = q.trim().toLowerCase();

  const activeGroup = groups.find((g) => g.pages.some((p) => p.path === path));
  const toggle = (id: string, v: boolean) =>
    setOpen((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const filtered = groups
    .map((g) => ({ ...g, pages: query ? g.pages.filter((p) => p.label.toLowerCase().includes(query) || g.label.toLowerCase().includes(query)) : g.pages }))
    .filter((g) => g.pages.length > 0);

  const badge = (p: NavPage) => (p.path.startsWith("/event/") ? <EventBadge id={p.id as EventId} /> : p.id === "log" ? <CountBadge>{state.log.length}</CountBadge> : undefined);

  return (
    <SidebarNav>
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages"
              aria-label="Search pages"
              className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-2 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => setOpen(new Set(groups.map((g) => g.id)))} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1 text-xs hover:bg-muted">
              <Plus className="size-3" />Expand All
            </button>
            <button onClick={() => setOpen(new Set())} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1 text-xs hover:bg-muted">
              <Minus className="size-3" />Collapse All
            </button>
          </div>
        </div>
      )}
      <SidebarSection>
        {filtered.map((g) => {
          const Icon = g.icon;
          const icon = <Icon className={`size-[18px] ${g.color}`} stroke={1.75} />;
          if (g.pages.length === 1 && g.pages[0].label === g.label) {
            const p = g.pages[0];
            return (
              <SidebarItem key={g.id} icon={icon} active={p.path === path} onClick={() => navigate(p.path)}>
                {p.label}
              </SidebarItem>
            );
          }
          return (
            <SidebarNested
              key={g.id}
              label={g.label}
              icon={icon}
              active={activeGroup?.id === g.id}
              open={query ? true : open.has(g.id) || activeGroup?.id === g.id}
              onOpenChange={(v) => toggle(g.id, v)}
            >
              {g.pages.map((p) => (
                <SidebarItem key={p.id + p.path} active={p.path === path} onClick={() => navigate(p.path)} badge={badge(p)}>
                  {p.label}
                </SidebarItem>
              ))}
            </SidebarNested>
          );
        })}
        {filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No pages match.</p>}
      </SidebarSection>
    </SidebarNav>
  );
}

function UserFooter() {
  const { collapsed } = useSidebar();
  const { user, role } = useSession();
  const initials = user.name.split(" ").filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("");
  return (
    <div className="flex w-full flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Switch user">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-move/15 text-xs font-semibold text-move">{initials}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{role.label}</span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch demo user</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {USERS.map((u) => (
            <DropdownMenuItem
              key={u.id}
              onClick={() => {
                switchUser(u.id);
                navigate("/opd");
              }}
            >
              <span className="flex flex-col">
                <span className="text-sm">{u.name}</span>
                <span className="text-xs text-muted-foreground">{ROLES.find((r) => r.id === u.role)?.label}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Palette() {
  const [open, setOpen] = React.useState(false);
  const groups = useVisibleNav();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to page" description="Search every page you can open">
      <CommandInput placeholder="Go to page" />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.id} heading={g.label}>
            {g.pages.map((p) => (
              <CommandItem
                key={p.id + p.path}
                value={`${g.label} ${p.label}`}
                onSelect={() => {
                  setOpen(false);
                  navigate(p.path);
                }}
              >
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function Page() {
  const route = useRoute();
  const path = route.path;
  if (path.startsWith("/event/")) {
    const id = path.replace("/event/", "") as EventId;
    if (EVENT_BY_ID[id]) return <ScenarioPage key={`${id}?${route.params.toString()}`} eventId={id} />;
  }
  if (path.startsWith("/m/")) return <MasterPage key={path} id={path.replace("/m/", "")} />;
  switch (path) {
    case "/opd": return <WorklistPage mode="opd" />;
    case "/ipd": return <WorklistPage mode="ipd" />;
    case "/er": return <EmergencyBoard />;
    case "/chart": return <ChartPage />;
    case "/patients": return <PatientsPage />;
    case "/confidential": return <ConfidentialPage />;
    case "/registration": return <RegistrationPage />;
    case "/beds": return <BedBoardPage />;
    case "/lab": return <LabWorklistPage />;
    case "/radiology": return <RadiologyWorklistPage />;
    case "/pharmacy/dispense": return <PharmacyDispensePage />;
    case "/audit": return <AuditPage />;
    case "/access": return <AccessPage />;
    case "/compliance": return <CompliancePage />;
    case "/ai-governance": return <AiGovernancePage />;
    case "/nphies-clinical": return <NphiesClinicalPage />;
    case "/nphies-financial": return <NphiesFinancialPage />;
    case "/encounters": return <EncountersPage />;
    case "/runner": return <RunnerPage />;
    case "/log": return <LogPage />;
    case "/spec": return <SpecPage />;
    default: return <WorklistPage mode="opd" />;
  }
}

export default function App() {
  const route = useRoute();
  const dev = useDevMode();
  const { role } = useSession();

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar variant="collapsible" width={270} aria-label="Main navigation" className="bg-[var(--sidebar,var(--background))]">
        <SidebarHeader className="h-auto min-h-[60px] py-3">
          <Brand />
          <SidebarToggle className="ml-auto" />
        </SidebarHeader>
        <NavTree path={route.path} />
        <SidebarFooter>
          <div className="flex w-full flex-col gap-2.5">
            <UserFooter />
            <PoweredBy />
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[1500px] flex-col px-6 pb-6 pt-6">
          <div className="mb-5 flex flex-wrap items-center gap-2.5 border-b border-border pb-3 text-[0.8125rem]">
            <p className="min-w-0 flex-1 text-muted-foreground">
              Test bench with made-up patients. Nothing is sent to NPHIES. Signed in as <strong className="font-semibold text-foreground">{role.label}</strong>.
              <span className="hidden lg:inline"> Press Ctrl+K to jump to any page.</span>
            </p>
            <DisplayMenu />
            <Button size="sm" onClick={lockScreen} title="Lock the screen"><Lock className="size-4" />Lock</Button>
            <div role="group" aria-label="View" className="flex rounded-lg border border-border bg-muted p-0.5">
              {([[false, "HIS View"], [true, "Developer View"]] as const).map(([v, label]) => (
                <button
                  key={label}
                  onClick={() => setDevMode(v)}
                  aria-pressed={dev === v}
                  className={`rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors ${dev === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Page />
          <div className="h-10 shrink-0" aria-hidden="true" />
          <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border pe-40 pt-4 text-xs text-muted-foreground">
            <span>&copy; {new Date().getFullYear()} Ebttikar. All rights reserved. Onasi and the Onasi logo are products and marks of Ebttikar.</span>
            <span>All patients shown are made up.</span>
          </footer>
        </div>
      </main>
      <Palette />
      <AiAssistant />
      <ToastHost />
      <IdleLock />
    </div>
  );
}
