import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

const allComps: string[] = ["innertextedit", "innerpanel", "outerpanel", "box", "box_textedit", "intextlink"] as const;

async function clearState() {
  allComps.forEach(c => tt.comp(c + "_dirty").setValue(false));
  await test.wait("ui");
}

async function expectDirty(which: Array<typeof allComps[number]>) {
  await test.wait(() => allComps.every(c => tt.comp(c + "_dirty").getValue() === which.includes(c)), "Expected dirty state to be " + which.join(","));
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/dirty.recursivedirty');
      await test.wait("ui");
      for (const comp of allComps)
        test.eq(false, tt.comp(comp + "_dirty").getValue(), `${comp} should start clean`);

      // Update textedit value
      tt.comp("innertextedit").setValue("some text");
      await expectDirty(["innertextedit", "innerpanel", "outerpanel"]);
      await clearState();

      tt.comp("innerbox!heading!cbox").setValue(true);
      await expectDirty(["box", "outerpanel"]);
      await clearState();

      tt.comp("innerbox!heading!cbox").setValue(false);
      await expectDirty(["box", "outerpanel"]);
      await clearState();

      tt.comp("innertextedit").setValue("some text");
      tt.comp("box_textedit").setValue("some text");
      await expectDirty(["box_textedit", "box", "outerpanel"]);
      await clearState();

      tt.comp("box_textedit").setValue("changed text");
      await expectDirty(["box_textedit", "box", "outerpanel"]);
      await clearState();

      test.clickTolliumLabel("External link");
      await expectDirty(["intextlink", "innerpanel", "outerpanel"]);
      await clearState();

      tt.comp("intextlink!external").setValue("https://example.com/");
      await expectDirty(["intextlink", "innerpanel", "outerpanel"]);
      await clearState();

      tt.comp("intextlink!external").setValue("https://example.org/");
      await expectDirty(["intextlink", "innerpanel", "outerpanel"]);
      await clearState();
    }
  ]);
