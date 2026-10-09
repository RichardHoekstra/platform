import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';
import { isTruthy, throwError } from '@webhare/std';
import * as testwrd from "@mod-wrd/js/testframework";
import { rpc } from '@webhare/rpc';

const webroot = test.getTestSiteRoot();
let setupdata: TestSetupData | null = null;
let pietje_resetlink = '';
let totpsecret = '';
let totpdata;
let totpbackupcodes = '';
let loginpage = "";
const usedCodes = new Set<string>;

test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });
    },

    "create Pietje",
    async function () {
      await test.load(webroot + 'portal1/' + setupdata?.overridetoken + "&notifications=0&lang=en");
      await test.waitForUI();

      // start usermgmt
      test.click(test.qSA('li li').filter(node => node.textContent?.includes("User Management"))[0]);
      await test.waitForUI();

      test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("webhare_testsuite.unit"))[0]);
      await test.waitForUI();

      // Create user pietje@allow2fa.test.webhare.net
      test.clickToddToolbarButton("Add", "New user");
      await test.waitForUI();

      test.setTodd('username', "pietje@allow2fa.test.webhare.net");
      test.clickToddButton('OK');
      await test.waitForUI();

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.waitForUI();
      test.clickToddButton('OK');
      await test.waitForUI();
      pietje_resetlink = test.getCurrentScreen().getValue("resetlink!previewurl");
      test.clickToddButton('Close');
      await test.waitForUI();
    },

    "set Pietje password",
    async function () {
      await test.load(pietje_resetlink);
      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "xecret");
      test.eq(null, (await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net"))?.whuserLastlogin, "Password reset is not a login!");
      await testwrd.runLogin("pietje@allow2fa.test.webhare.net", "xecret");
      test.eqPartial({ whuserLastlogin: (d: Date | null) => Boolean(d && d.getTime() <= Date.now() && d.getTime() >= Date.now() - 5000) }, (await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net")));
    },

    "enable TOTP",
    async function enable2FA() {
      test.click(await test.waitForElement("#dashboard-user-name"));
      await test.waitForUI();
      test.click(test.qSA("button").filter(e => e.textContent === "Change")[1]);
      await test.waitForUI();

      // setup one-time access code
      test.clickToddButton('Setup');
      await test.waitForUI();

      // enter current password
      test.setTodd('password', "xecret");
      test.clickToddButton('OK');
      await test.waitForUI();

      test.click(test.qSA("t-text").filter(e => e.textContent === "Show the secret key")[0]);
      await test.waitForUI();

      totpsecret = test.getCurrentScreen().getValue("totpsecret");
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: -61 });

      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("button").filter(e => e.textContent?.startsWith("Next"))[0]);
      await test.waitForUI();

      test.eq(/your clock is -[69]0 seconds off/, test.getCurrentScreen().getNode()?.textContent);
      test.clickToddButton('OK');
      await test.waitForUI();
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("button").filter(e => e.textContent?.startsWith("Next"))[0]);
      await test.waitForUI();

      totpbackupcodes = test.getCurrentScreen().getValue("backupcodes_text").split("\n").filter(isTruthy);

      test.clickToddButton('Finish');
      await test.waitForUI();

      test.eq("Configured", test.getCurrentScreen().getValue("totp"));
      test.eq("Used 0 of 10 backup codes", test.getCurrentScreen().getValue("totpbackupcodes"));

      test.clickToddButton('Close');
      await test.waitForUI();

      test.clickToddButton('OK');
      await test.waitForUI();
      await test.sleep(100); // wait for dashboard to appear

      await test.runTolliumLogout();
      loginpage = test.getWin().location.href;
    },

    "login Pietje with 2FA code",
    async function () {
      const { whuserLastlogin } = await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net") ?? throwError("Pietje not found");
      test.assert(whuserLastlogin);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');
      await test.waitForUI();

      test.eqPartial({ whuserLastlogin }, await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net"), "Partial TOTP is not a real login!");

      // STORY: test an invalid code
      // gather a lot of valid codes
      const validcodes = [];
      for (let offset = 120; offset >= -90; offset -= 30) {
        totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset });
        validcodes.push(totpdata.code);
      }

      // Get an invalid code
      let wrongcode = "000000";
      while (validcodes.includes(wrongcode))
        wrongcode = `00000${parseInt(wrongcode, 10) + 1}`.substr(-6);

      test.fill("[name=totp]", wrongcode);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();
      test.eq(/This code is not valid/, test.getDoc().body.textContent);
      test.eq(/5 attempts left/, test.getDoc().body.textContent);

      // STORY: test an valid code (after using an invalid code)
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.fill("[name=totp]", totpdata.code);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();

      usedCodes.add(totpdata.code);

      await test.wait('load');
      await test.waitForUI();

      // should be logged in
      test.assert(Boolean(test.qS("#dashboard-logout")));

      // verify lastlogin is updated
      const userinfo = await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net");
      test.eqPartial({ whuserLastlogin: (d: Date | null) => Boolean(d && d.getTime() > whuserLastlogin.getTime()) }, userinfo);

      // logout
      await test.runTolliumLogout();
    },

    "login Pietje with backup code",
    async function () {
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      test.fill("[name=totp]", totpbackupcodes[0]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.wait('load');
      await test.waitForUI();

      // should be logged in
      test.assert(Boolean(test.qS("#dashboard-logout")));

      // logout
      await test.runTolliumLogout();
    },

    "Second login invalidates other ones",
    async function () {
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      await test.addFrame("second", { width: 300 });
      await test.load(loginpage);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      await test.selectFrame("main");
      test.fill('[name=totp]', totpbackupcodes[1]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();

      test.eq(/session.*expired/, test.getDoc().body.textContent);
      await test.removeFrame("second");
    },

    "Lockout after 6 failed attempts",
    async function () {
      await test.load(loginpage);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      const validCodes = new Set<string>();

      let wrongcode = "000000";
      for (let left = 6; left >= 0; --left) {
        for (let offset = 120; offset >= -90; offset -= 30) {
          totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset });
          validCodes.add(totpdata.code);
        }

        // Get an invalid code
        while (validCodes.has(wrongcode))
          wrongcode = `00000${parseInt(wrongcode, 10) + 1}`.substr(-6);

        test.fill("[name=totp]", wrongcode);
        (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
        await test.waitForUI();
        if (left > 1) {
          test.eq(/This code is not valid/, test.getDoc().body.textContent);
          test.eq(new RegExp(`${left - 1} attempt${left === 2 ? "" : "s"} left`), test.getDoc().body.textContent);
        }
      }

      // exhausted login attempts, locked out from using normal codes
      test.eq(/ a wrong code too many times/, test.getDoc().body.textContent);

      await test.load(loginpage);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');
      test.eq(/ a wrong code too many times/, test.getDoc().body.textContent);

      // backup code should work
      test.fill('[name=totp]', totpbackupcodes[1]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.wait('load');
      await test.waitForUI();

      // should be logged in
      test.assert(Boolean(test.qS("#dashboard-logout")));

      // logout
      await test.runTolliumLogout();

      await test.load(loginpage);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      // error should be gone, login with code again
      test.assert(!/ a wrong code too many times/.test(test.getDoc().body.textContent));
      await test.load(loginpage);
    },

    "login with same code twice",
    async function () {
      await test.load(loginpage);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      if (usedCodes.has(totpdata.code)) {
        // get the next code, code matching should be flexible enough to allow it
        totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 30 });
      }

      console.log(`secret: ${totpsecret}, code: ${totpdata.code}`);
      test.fill("[name=totp]", totpdata.code);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.wait('load');
      await test.waitForUI();
      test.assert(Boolean(test.qS("#dashboard-logout")));
      await test.runTolliumLogout();

      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');
      test.fill("[name=totp]", totpdata.code);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();
      test.assert(/This code has already been used to login/.test(test.getDoc().body.textContent));

      test.fill("[name=totp]", totpbackupcodes[1]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();
      test.assert(/This backup code has already been used to login/.test(test.getDoc().body.textContent));
    },

    "login but first lock pietje",
    async function () {
      await test.load(loginpage);
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#LockUser', 'pietje@allow2fa.test.webhare.net');
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      test.fill('[name=totp]', totpbackupcodes[2]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();

      await test.waitForElement([".wh-form__error", /Account is disabled/]);
    }
  ]);
