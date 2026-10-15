import * as dompack from '@webhare/dompack';
import * as $todd from "@mod-tollium/web/ui/js/support";
import * as menu from "@mod-tollium/web/ui/components/basecontrols/menu";
import * as toddImages from "@mod-tollium/js/icons";
import { getTid } from "@webhare/gettid";
import type { IndyShell } from '../shell';
import type { ApplicationBase } from '../application';
import type { AppMenuItem } from '../types';


/****************************************************************************************************************************
 *                                                                                                                          *
 *  TOLLIUM DESKTOP (TASKBAR, SHORTCUTS, ETC.)                                                                              *
 *                                                                                                                          *
 ****************************************************************************************************************************/

const appbarsymbol: unique symbol = Symbol();

// These runtime app properties are missing from ApplicationBase's legacy declaration.
type AppBarApplication = ApplicationBase & {
  appiconwidth: number;
  appiconheight: number;
  hasissues: boolean;
  isdebugged: boolean;
  isdebugpaused: boolean;
  tabmodifier: string;
};

type AppBarTabRoot = HTMLDivElement & {
  [appbarsymbol]: { tabmodifier: string; tab: ApplicationTab };
};

type ScreenUpdateEvent = CustomEvent<{
  screen: { parentwindow?: unknown };
  allowclose: boolean;
}>;

type ScrollState = { time: number; start: number; isleft: boolean };

class ApplicationTab {
  readonly _appbar: ApplicationBar;
  app: AppBarApplication | null = null;
  fixed: boolean;
  menuitem: HTMLLIElement;
  root: AppBarTabRoot;
  icon: HTMLImageElement;
  close: HTMLSpanElement;
  title: HTMLSpanElement;
  private readonly updatescreenListener: (event: Event) => void;
  private readonly updateappListener: (event: Event) => void;

  constructor(appbar: ApplicationBar, app: AppBarApplication, fixed: boolean) {
    this._appbar = appbar;

    // New application
    this.root =
      <div className="t-apptab t-apptab--hasicon"
        on={{
          "contextmenu": (event: MouseEvent) => this.onTabContextMenu(event),
          "click": (event: MouseEvent) => this.onTabClick(event)
        }}>
        {this.icon = toddImages.createImage(app.appicon || 'tollium:tollium/tollium', app.appiconwidth || 16, app.appiconheight || 16, "w", { className: "t-apptab__icon" })}
        {this.close = <span className="t-apptab__close" onMousedown={
          //prevent taking focus when the closer is clicked. this mirrors current Tollium behavior and is tested by testappbar
          (evt: Event) => evt.preventDefault()
        } />}
        {this.title = <span title={app.title} className="t-apptab__title">{app.title}</span>}
        <span className="t-apptab__dirty" title={getTid("tollium:shell.appdirty")} />
      </div>;

    // Cache the modifier so updates can remove the previous CSS class.
    (this.root as AppBarTabRoot)[appbarsymbol] = {
      tabmodifier: '',
      tab: this
    };
    this.menuitem = <li onClick={(evt: MouseEvent) => this.onActivateTab(evt)}>{app.title}</li>;
    this.fixed = fixed;

    this.updatescreenListener = event => this.onUpdateScreen(event);
    this.updateappListener = event => this.onUpdateApp(event);
    this.replaceApp(app);
  }

  replaceApp(newapp: AppBarApplication | null) {
    const wasactive = this.app && this.app === $todd.getActiveApplication();
    if (this.app) {
      this.app.appnodes.root.removeEventListener("tollium:updatescreen", this.updatescreenListener);
      this.app.appnodes.root.removeEventListener("tollium:updateapp", this.updateappListener);
    }
    this.app = newapp;
    if (this.app) {
      this.app.appnodes.root.addEventListener("tollium:updatescreen", this.updatescreenListener);
      this.app.appnodes.root.addEventListener("tollium:updateapp", this.updateappListener);
      // Preserve activation when replacing the currently active application.
      if (wasactive)
        this._appbar.shell.appmgr.activate(this.app);
    }
  }

  destroy() {
    this.replaceApp(null);
    this.root.remove();
  }

  private onActivateTab(event: Event) {
    dompack.stop(event);
    if (this.app)
      this._appbar.shell.appmgr.activate(this.app);
  }

  onUpdateScreen(event: Event) {
    const update = event as ScreenUpdateEvent;
    if (update.detail.screen.parentwindow === null || update.detail.screen.parentwindow === undefined) //we only honor updates from the toplevel screen
      this.root.classList.toggle("t-apptab--allowclose", update.detail.allowclose);
  }

  onUpdateApp(_event: Event) {
    if (!this.app)
      return;
    this.root.classList.toggle('t-apptab--hasicon', Boolean(this.app.appicon));
    this.root.classList.toggle('t-apptab--hasissues', this.app.hasissues);
    this.root.classList.toggle('t-apptab--isdebugrunning', this.app.isdebugged && !this.app.isdebugpaused);
    this.root.classList.toggle('t-apptab--isdebugpaused', this.app.isdebugged && this.app.isdebugpaused);
    if (this.root[appbarsymbol].tabmodifier !== this.app.tabmodifier) {
      if (this.root[appbarsymbol].tabmodifier)
        this.root.classList.remove('t-apptab--' + this.root[appbarsymbol].tabmodifier);
      if (this.app.tabmodifier)
        this.root.classList.add('t-apptab--' + this.app.tabmodifier);
      this.root[appbarsymbol].tabmodifier = this.app.tabmodifier;
    }
    this.root.classList.toggle('t-apptab--dirty', Boolean(this.app.dirty));

    if (this.app.appicon)
      toddImages.updateImage(this.icon, this.app.appicon, this.app.appiconwidth, this.app.appiconheight, 'w');
    this.title.textContent = this.app.title;
    this.title.title = this.app.title;
    this.menuitem.textContent = this.app.title;
    this.menuitem.classList.toggle("dirty", Boolean(this.app.dirty));
    this._appbar._resize();
  }

  onTabClick(event: MouseEvent) {
    if (!this.app)
      return;
    this._appbar.shell.appmgr.activate(this.app);
    if (event.target instanceof Element && event.target.closest(".t-apptab__close")) //it's the closer being clicked
      this.app.requestClose();
  }
  onTabContextMenu(event: MouseEvent) {
    if (!this.app)
      return;
    dompack.stop(event);

    const appmenu = this.app.generateAppMenu();
    this._appbar.apptabmenu.replaceChildren();
    appmenu.forEach(menuitem => {
      const item = ("isdivider" in menuitem && menuitem.isdivider) ? <li class="divider" />
        : <li onClick={(evt: MouseEvent) => this.onTabContextMenuClick(evt, menuitem)}>{"title" in menuitem ? menuitem.title : ""}</li>;
      this._appbar.apptabmenu.appendChild(item);
    });

    menu.openAt(this._appbar.apptabmenu, event);
  }
  onTabContextMenuClick(event: Event, menuitem: AppMenuItem) {
    dompack.stop(event);
    if ("cmd" in menuitem && menuitem.cmd && this.app)
      this.app.executeCommand(menuitem.cmd);
  }
}

/****************************************************************************************************************************
 * The application tabs bar
 */

export default class ApplicationBar {
  readonly shell: IndyShell;
  readonly node: HTMLElement;
  apps: ApplicationTab[] = [];
  readonly appnavmenu = document.createElement("ul");
  readonly name: string;
  readonly fixed_node: HTMLElement;
  readonly dyn_node: HTMLElement;
  readonly dyn_content_node: HTMLElement;
  readonly nav_node: HTMLElement;
  readonly scroll_left_node: HTMLElement;
  readonly scroll_right_node: HTMLElement;
  readonly apptabmenu: HTMLUListElement;
  scrollstate: ScrollState | null;
  scrollstepscheduled: boolean;
  tabmodifier: string;

  constructor(shell: IndyShell, appbar: HTMLElement) {
    this.name = "(applicationbar)";
    this.scrollstate = null;
    this.scrollstepscheduled = false;
    this.tabmodifier = '';

    this.shell = shell;
    this.node = appbar;

    this.shell.appmgr.addEventListener("activateapp", () => this.updateActiveApp());

    this.apptabmenu = dompack.create("ul");

    this.fixed_node = dompack.qR(this.node, ".t-apptabs__fixed");
    this.dyn_node = dompack.qR(this.node, ".t-apptabs__dynamic");
    this.dyn_content_node = dompack.qR(this.dyn_node, ".t-apptabs__content");
    this.nav_node = dompack.qR(this.dyn_node, ".t-apptabs__navtab");
    this.scroll_left_node = dompack.qR(this.dyn_node, ".t-apptabs__leftscroll");
    this.scroll_right_node = dompack.qR(this.dyn_node, ".t-apptabs__rightscroll");

    this.nav_node.addEventListener("click", this.onNavMenuClick.bind(this));

    this.scroll_left_node.addEventListener("mouseover", evt => this.scrollMouseOver(evt, -1));
    this.scroll_left_node.addEventListener("mouseout", evt => this.scrollCancel(evt));
    this.scroll_right_node.addEventListener("mouseover", evt => this.scrollMouseOver(evt, 1));
    this.scroll_right_node.addEventListener("mouseout", evt => this.scrollCancel(evt));

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  private scrollCancel(_event?: Event) {
    this.scrollstate = null;
  }
  private scrollMouseOver(event: MouseEvent, dir: number) {
    dompack.stop(event);
    this.scrollstate =
    {
      time: Date.now(),
      start: this.dyn_content_node.scrollLeft,
      isleft: dir < 0
    };
    this.handleScrollStep();
  }
  private calcScrollDistance() {
    const scrollstate = this.scrollstate;
    if (!scrollstate)
      return 0;
    const speed = 400; // pixels per second
    const acctime = 2; // accelerate to final speed in this much seconds (normal acceleration)
    const timediff = (Date.now() - scrollstate.time) / 1000;

    const accphasepart = timediff > acctime ? 2 : timediff;
    const accphase = .5 * (speed / acctime) * accphasepart * accphasepart;
    const linearphase = speed * (timediff - accphasepart);

    return accphase + linearphase;
  }
  private handleScrollStep(from_raf = false) {
    if (from_raf)
      this.scrollstepscheduled = false;
    if (!this.scrollstate)
      return;

    const dist = this.calcScrollDistance();
    this.dyn_content_node.scrollLeft = this.scrollstate.start + (this.scrollstate.isleft ? -1 : 1) * dist;
    this._resize();

    if (this.scrollstate) {
      // Continue the animation until scrolling is canceled or reaches an edge.
      this.scrollstepscheduled = true;
      requestAnimationFrame(this.handleScrollStep.bind(this, true));
    }
  }

  private onNavMenuClick(_event: Event) {
    // Add all apps (first the fixed apps, then the unfixed ones)
    this.appnavmenu.replaceChildren(
      ...this.apps.filter(item => item.fixed).map(item => item.menuitem),
      ...this.apps.filter(item => !item.fixed).map(item => item.menuitem)
    );

    menu.openAt(this.appnavmenu, this.nav_node, { direction: 'down', align: 'right' });
  }

  _gotoApp(how: string, idx: number) {
    if (how === 'relative') {
      const appidx = this.apps.findIndex(app => app.app === $todd.getActiveApplication());
      if (appidx < 0)
        return;

      // Wrap around when cycling past either end of the tab list.
      const gotoappidx = (appidx + this.apps.length + idx) % this.apps.length;
      const app = this.apps[gotoappidx]?.app;
      if (app)
        this.shell.appmgr.activate(app);
    } else if (how === 'absolute') {
      const app = idx >= 0 ? this.apps[idx]?.app : null;
      if (app)
        this.shell.appmgr.activate(app);
    }
  }

  // shortcut.app Application object
  // shortcut.icononly Only show icon (e.g. for homescreen app)
  toggleShortcut(app: ApplicationBase, show: boolean, fixed = false) {
    const appidx = this.apps.findIndex(elt => elt.app === app);
    fixed = fixed || false;

    if (show) {
      let newtab: ApplicationTab;
      if (appidx < 0) {
        newtab = new ApplicationTab(this, app as AppBarApplication, fixed);
      } else {
        // Already exists
        newtab = this.apps[appidx];

        // If not changed from fixed<->dynamic, we're done
        if (newtab.fixed === fixed)
          return;

        newtab.fixed = fixed;

        // Reinsert the app, so the ordering within fixed/non-fixed classes stays ok
        this.apps.splice(appidx, 1);
      }

      this.apps.push(newtab);

      // (re-)insert at the right nav node
      if (fixed)
        this.fixed_node.appendChild(newtab.root);
      else
        this.dyn_content_node.appendChild(newtab.root);
    } else {
      if (appidx < 0)
        return;

      this.apps[appidx].destroy();
      this.apps.splice(appidx, 1);
    }

    this.recalculateCSSClasses();

    this._resize();
  }

  private recalculateCSSClasses() {
    const allnodes = dompack.qSA(this.node, ".t-apptab");

    allnodes.forEach(function (item, idx) {
      item.classList.toggle("t-apptab--first", idx === 0);
      item.classList.toggle("t-apptab--last", idx === allnodes.length - 1);
      item.classList.toggle("t-apptab--prevactiveapp", idx !== 0 && allnodes[idx - 1].classList.contains("t-apptab--activeapp"));
    });
  }

  _resize() {
    const parent = this.node.parentElement;
    if (!parent)
      return;
    const total_width = parent.offsetWidth;
    const fixed_width = this.fixed_node.offsetWidth;
    const dyn_scroll_pos = this.dyn_content_node.scrollLeft;
    const nav_width = this.nav_node.offsetWidth;

    // Calc the requested width from the width of the content
    let dyn_scroll_width = 0;
    const lasttab = this.dyn_content_node.lastElementChild as HTMLElement | null;
    if (lasttab)
      dyn_scroll_width = lasttab.offsetLeft + lasttab.offsetWidth;

    const dyn_width = total_width - fixed_width;
    const overflow = dyn_scroll_width > dyn_width;
    const dyn_content_width = dyn_width - (overflow ? nav_width : 0);

    const can_scroll_left = dyn_scroll_pos !== 0;
    const can_scroll_right = dyn_scroll_width - dyn_content_width - dyn_scroll_pos >= 1;

    this.dyn_node.style.left = fixed_width + 'px';
    this.dyn_node.style.width = dyn_width + 'px';
    this.dyn_content_node.style.width = dyn_content_width + 'px';

    this.node.classList.toggle("t-apptabs--canscrollleft", can_scroll_left);
    this.node.classList.toggle("t-apptabs--canscrollright", can_scroll_right);

    const scrollstate = this.scrollstate;
    if (scrollstate) {
      if (!can_scroll_left && scrollstate.isleft)
        this.scrollstate = null;
      if (!can_scroll_right && !scrollstate.isleft)
        this.scrollstate = null;
    }
  }

  updateActiveApp() {
    this.node.style.display = this.anyShortcuts() ? "block" : "none";
    for (const appnode of this.node.querySelectorAll(".t-apptab--activeapp"))
      appnode.classList.remove("t-apptab--activeapp");

    const appidx = this.apps.findIndex(app => app.app === $todd.getActiveApplication());
    if (appidx >= 0) {
      this.apps[appidx].root.classList.add("t-apptab--activeapp");

      // Scroll to active node
      this.apps[appidx].root.scrollIntoView();
      this.scrollstate = null;

      this._resize();
    }
    this.recalculateCSSClasses();
  }
  anyShortcuts() {
    return this.apps.length > 0;
  }
  replaceAppWith(oldapp: ApplicationBase, newapp: ApplicationBase) {
    const idx = this.apps.findIndex(_ => _.app === oldapp);
    if (idx === -1) //old app isn't on the bar either
      return;

    this.apps[idx].replaceApp(newapp as AppBarApplication);
  }
}
