import * as test from "@webhare/test-frontend";

type PopoverEvent = {
  type: string;
  oldState: string;
  newState: string;
  cancelable: boolean;
  bubbles: boolean;
};

test.runTests([
  "Popover activation",
  async function () {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=empty');
    test.getDoc().body.innerHTML = `
      <button id="open" type="button" popovertarget="menu1"><span id="label">Open Menu 1</span></button>
      <button id="show" type="button" popovertarget="menu1" popovertargetaction="show">Show Menu 1</button>
      <button id="disabled" type="button" popovertarget="menu1" disabled>Disabled</button>
      <button id="missing" type="button" popovertarget="missing-menu">Missing target</button>
      <button id="outside" type="button">Outside popovers</button>
      <div id="menu1" popover="auto" style="margin:0; left:20px; top:120px">
        <p>Main Menu</p>
        <button id="submenu" type="button" popovertarget="menu2">Open Submenu</button>
        <button id="hide" type="button" popovertarget="menu1" popovertargetaction="hide">Hide Menu 1</button>
      </div>
      <div id="menu2" popover="auto" style="margin:0; left:400px; top:120px"><p>Submenu Content</p></div>`;

    const menu = test.qR("#menu1");
    const events: PopoverEvent[] = [];
    for (const type of ["beforetoggle", "toggle"])
      menu.addEventListener(type, event => {
        const toggle = event as ToggleEvent;
        events.push({
          type: toggle.type,
          oldState: toggle.oldState,
          newState: toggle.newState,
          cancelable: toggle.cancelable,
          bubbles: toggle.bubbles
        });
      });

    test.eq(null, test.qS(":popover-open"));
    test.click("#label");
    test.eq(["menu1"], test.qSA(":popover-open").map(node => node.id));
    test.eq([
      { type: "beforetoggle", oldState: "closed", newState: "open", cancelable: true, bubbles: false }
    ], events);
    await test.wait(() => events.length === 2);
    test.eq({ type: "toggle", oldState: "closed", newState: "open", cancelable: false, bubbles: false }, events[1]);

    test.click("#show");
    test.eq(["menu1"], test.qSA(":popover-open").map(node => node.id));
    test.eq(2, events.length);

    test.click("#submenu");
    test.eq(["menu1", "menu2"], test.qSA(":popover-open").map(node => node.id));
    test.click("#submenu");
    test.eq(["menu1"], test.qSA(":popover-open").map(node => node.id));

    test.click("#hide");
    test.eq(null, test.qS(":popover-open"));
    test.eq({ type: "beforetoggle", oldState: "open", newState: "closed", cancelable: false, bubbles: false }, events[2]);
    await test.wait(() => events.length === 4);
    test.eq({ type: "toggle", oldState: "open", newState: "closed", cancelable: false, bubbles: false }, events[3]);

    test.click("#open");
    test.eq(true, menu.matches(":popover-open"));
    await test.wait(() => events.length === 6);
    test.click("#open");
    test.eq(false, menu.matches(":popover-open"));
    await test.wait(() => events.length === 8);

    const cancelClick = (event: Event) => event.preventDefault();
    test.qR("#open").addEventListener("click", cancelClick);
    test.click("#label");
    test.eq(false, menu.matches(":popover-open"));
    test.eq(8, events.length);
    test.qR("#open").removeEventListener("click", cancelClick);

    menu.addEventListener("beforetoggle", event => event.preventDefault(), { once: true });
    test.click("#open");
    test.eq(false, menu.matches(":popover-open"));
    test.eq(9, events.length);

    test.click("#disabled");
    test.click("#missing");
    test.eq(false, menu.matches(":popover-open"));
    test.eq(9, events.length);
  },

  "Popover light-dismiss boundaries",
  async function () {
    test.click("#open");
    test.click("#submenu");
    test.click("#menu2 p");
    test.eq(["menu1", "menu2"], test.qSA(":popover-open").map(node => node.id));

    test.click("#menu1 p");
    test.eq(["menu1"], test.qSA(":popover-open").map(node => node.id));
    await test.sendMouseGesture([
      { el: test.qR("#menu1 p"), down: 0 },
      { el: test.qR("#outside"), up: 0 }
    ]);
    test.eq(["menu1"], test.qSA(":popover-open").map(node => node.id));

    const manual = test.getDoc().createElement("div");
    manual.popover = "manual";
    manual.textContent = "Manual popover";
    manual.style.cssText = "margin:0; left:400px; top:250px";
    test.getDoc().body.append(manual);
    manual.showPopover();
    test.click("#outside");
    test.eq(false, test.qR("#menu1").matches(":popover-open"));
    test.eq(true, manual.matches(":popover-open"));
    manual.hidePopover();
    manual.remove();
  },

  "Clicking outside dismisses auto popovers",
  async function () {
    // Top-layer order, not DOM order, determines which popover closes first.
    test.qR("#menu1").before(test.qR("#menu2"));
    test.click("#open");
    test.click("#submenu");
    test.eq(["menu2", "menu1"], test.qSA(":popover-open").map(node => node.id));
    await Promise.all(test.qSA(":popover-open").map(menu => new Promise<void>(resolve => {
      menu.addEventListener("toggle", () => resolve(), { once: true });
    })));

    const events: string[] = [];
    for (const menu of test.qSA(":popover-open"))
      for (const type of ["beforetoggle", "toggle"])
        menu.addEventListener(type, event => {
          const toggle = event as ToggleEvent;
          if (toggle.newState === "closed") {
            test.eq("open", toggle.oldState);
            test.eq(false, toggle.cancelable);
            events.push(`${menu.id}:${toggle.type}`);
          }
        });

    test.click("#outside");
    test.eq(null, test.qS(":popover-open"));
    test.eq(["menu2:beforetoggle", "menu1:beforetoggle"], events);
    await test.wait(() => events.length === 4);
    test.eq([
      "menu2:beforetoggle", "menu1:beforetoggle",
      "menu2:toggle", "menu1:toggle"
    ], events);
  }
]);
