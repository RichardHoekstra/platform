import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { getApplyTesterForMockedObject, getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { openFile, openFolder } from "@webhare/whfs";
import { describeMetaTabs, remapForHs } from "@mod-publisher/lib/internal/siteprofiles/metatabs";
import { beginWork, commitWork } from "@webhare/whdb";
import { IntExtLink } from "@webhare/services";

async function testIgnoreMetatabsForOldContent() {
  //watches for global triggers of new metadata screens. we need to avoid that for now, don't surprise existing users
  const richdocfile = await openFile("site::webhare_testsuite.testsite/testpages/staticpage");
  const applytester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applytester, { mode: "editor" });
  test.eqPartial({ types: [] }, metatabs);
}

async function testMetadataReaderPermissions() {
  const richdocfile = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const imgfile = await openFile("site::webhare_testsuite.testsite/testpages/imgeditfile.jpeg");
  const docfile = await openFile("site::webhare_testsuite.testsite/testpages/staticpage");

  await test.throws(/Cannot invoke.*editor/, async () => describeMetaTabs(await getApplyTesterForObject(imgfile), { mode: "editor" }));

  const imgfileMetatabs = await describeMetaTabs(await getApplyTesterForObject(imgfile), { mode: "objectProps" });
  test.eq(null, imgfileMetatabs.workflowEditor);
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor", whfsType: "http://www.webhare.net/xmlns/beta/test" }
  ], imgfileMetatabs.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const docfileMetaTabsEditor = await describeMetaTabs(await getApplyTesterForObject(docfile), { mode: "editor" });
  test.assert(docfileMetaTabsEditor.workflowEditor);
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor", whfsType: "http://www.webhare.net/xmlns/beta/test" }
  ], docfileMetaTabsEditor.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  //The nocopyprops are in the objectProps:
  const docfileMetaTabsObjectProps = await describeMetaTabs(await getApplyTesterForObject(docfile), { mode: "objectProps" });
  test.assert(docfileMetaTabsObjectProps.workflowEditor);
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops" },
  ], docfileMetaTabsObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const imgfileMetatabsAsMarge = await describeMetaTabs(await getApplyTesterForObject(imgfile), { user: test.getUser("marge").auth, mode: "objectProps" });
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor", whfsType: "http://www.webhare.net/xmlns/beta/test" }
  ], imgfileMetatabsAsMarge.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const imgfileMetatabsAsMargeForObjectProps = await describeMetaTabs(await getApplyTesterForObject(imgfile), { user: test.getUser("marge").auth, mode: "objectProps" });
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" },
    { extension: 'mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops', whfsType: 'http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops', },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor", whfsType: "http://www.webhare.net/xmlns/beta/test" },
  ], imgfileMetatabsAsMargeForObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const docfileMetatabsAsSysop_Editor = await describeMetaTabs(await getApplyTesterForObject(docfile), { user: test.getUser("sysop").auth, mode: "editor" });
  test.eqPartial([
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops", whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" },
    { extension: "mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor", whfsType: "http://www.webhare.net/xmlns/beta/test" }
  ], docfileMetatabsAsSysop_Editor.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const docfileMetatabsAsSysop_ObjectProps = await describeMetaTabs(await getApplyTesterForObject(docfile), { user: test.getUser("sysop").auth, mode: "objectProps" });
  test.eqPartial([
    { whfsType: 'platform:publisher.lifecycle', extension: 'mod::publisher/tolliumapps/objectprops/extensions.xml#lifecycle' },
    { extension: 'mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops', whfsType: 'http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops', },
  ], docfileMetatabsAsSysop_ObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const imgfileMetatabsAsSysopForObjectProps = await describeMetaTabs(await getApplyTesterForObject(imgfile), { user: test.getUser("sysop").auth, mode: "objectProps" });
  test.eqPartial([
    {
      whfsType: 'platform:publisher.lifecycle',
      extension: 'mod::publisher/tolliumapps/objectprops/extensions.xml#lifecycle',
      title: 'publisher:siteprofile.internaltypes.lifecycle'
    },
    {
      whfsType: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
      extension: 'mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#basetestprops',
      title: ':WTS base test'
    },
    {
      whfsType: 'http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops',
      extension: 'mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#nocopyprops',
      title: ':http://www.webhare.net/xmlns/webhare_testsuite/nocopyprops'
    },
    {
      whfsType: 'http://www.webhare.net/xmlns/beta/test',
      extension: 'mod::webhare_testsuite/webdesigns/basetest/basetest.siteprl.xml#testeditor',
      title: ':Beta Test Contenttype'
    }
  ], imgfileMetatabsAsSysopForObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const richdocfileMetatabsAsMargeForObjectProps = await describeMetaTabs(await getApplyTesterForObject(richdocfile), { user: test.getUser("marge").auth, mode: "objectProps" });
  test.eqPartial([], richdocfileMetatabsAsMargeForObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  const richdocfileMetatabsAsSysopForObjectProps = await describeMetaTabs(await getApplyTesterForObject(richdocfile), { user: test.getUser("sysop").auth, mode: "objectProps" });
  test.eqPartial([
    {
      whfsType: 'platform:publisher.lifecycle',
      extension: 'mod::publisher/tolliumapps/objectprops/extensions.xml#lifecycle',
      title: 'publisher:siteprofile.internaltypes.lifecycle'
    }
  ], richdocfileMetatabsAsSysopForObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

}

async function testMetadataReader() {
  const imgfile = await openFile("site::webhare_testsuite.testsite/testpages/imgeditfile.jpeg");

  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const seoTitleImage = await tmpfolder.createFile("seotitle-image", { type: "platform:filetypes.image" });
  test.eq({ seoTitle: false, description: true, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: false },
    (await describeMetaTabs(await getApplyTesterForObject(seoTitleImage), { mode: "objectProps" })).baseProperties);

  //we name it manualtabs just to trigger base_test_props (HS testsite has it everywhere)
  const imageContentLink = await tmpfolder.createFile("imagecontentlink-manualtabs", { type: "platform:filetypes.contentlink", target: new IntExtLink(imgfile.id) });

  //An RTD may show seoTitle/description in the Editor, but *not* in objevtprops
  const seoTitleRTD = await tmpfolder.createFile("seotitle-rtd", { type: "platform:filetypes.richdocument" });
  test.eq({ seoTitle: true, description: true, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: true },
    (await describeMetaTabs(await getApplyTesterForObject(seoTitleRTD), { mode: "editor" })).baseProperties);
  test.eq({ seoTitle: false, description: false, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: true },
    (await describeMetaTabs(await getApplyTesterForObject(seoTitleRTD), { mode: "objectProps" })).baseProperties);

  await commitWork();

  const richdocfile = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const applytester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applytester, { mode: "editor" });

  test.assert(metatabs.workflowEditor);
  test.eq({ seoTitle: true, description: true, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: true }, metatabs.baseProperties);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        sections: [
          {
            title: ':WTS base test',
            fields: [
              {
                name: "anyField",
                title: ":Any field",
                component: { textedit: { valueConstraints: { maxBytes: 4096 } } }
              }, {
                name: "numberField",
                constraints: {
                  valueType: "integer",
                  minValue: 0,
                  maxValue: 100
                },
                component: { textedit: { valueType: 'integer', suffix: "kg", emptyValue: 1 } }
              }, {
                name: "whUser",
                title: "~username",
                component: { "http://www.webhare.net/xmlns/system/components#selectuser": { inputKind: "wrdGuid" } }
              }, {
                name: "rtd"
              }, {
                name: "multiField"
              }, {
                name: "checkIt"
              }, {
                name: "extControlledField"
              }, {
                name: "aLink",
                component: { "http://www.webhare.net/xmlns/publisher/components#intextlink": {} }
              }
            ]
          }, {
            title: ":Folksonomy tags",
            fields: [
              {
                name: "folksonomy"
              }
            ]
          },
        ]
      }
    ]
  }, metatabs);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        sections: [
          {
            title: ':WTS base test',
            fields: [
              {
                name: "any_field",
                title: ":Any field",
                component: {
                  ns: "http://www.webhare.net/xmlns/tollium/screens",
                  component: "textedit",
                  yamlprops: { value_constraints: { max_bytes: 4096 } }
                }
              }, {
                name: "number_field",
                constraints: {
                  value_type: "integer",
                  min_value: 0,
                  max_value: 100
                },
                component: {
                  ns: "http://www.webhare.net/xmlns/tollium/screens",
                  component: "textedit",
                  yamlprops: { value_type: "integer", value_constraints: { max_value: 100 } }
                }
              }, {
                name: "wh_user",
                title: "~username",
                component: {
                  ns: "http://www.webhare.net/xmlns/system/components",
                  component: "selectuser",
                  yamlprops: { input_kind: "wrdGuid", value_constraints: { value_type: "string" } }
                }
              }, {
                name: "rtd"
              }, {
                name: "multi_field"
              }, {
                name: "check_it"
              }, {
                name: "ext_controlled_field"
              }, {
                name: "a_link",
              }
            ]
          }, {
            title: ":Folksonomy tags",
            fields: [
              {
                name: "folksonomy"
              }
            ]
          }
        ]
      }
    ]
  }, remapForHs(metatabs!));

  const richdocfilelink = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage-contentlink");
  const richdocfilelinkObjectProps = await describeMetaTabs(await getApplyTesterForObject(richdocfilelink), { user: test.getUser("sysop").auth, mode: "objectProps" });
  test.eqPartial([
    { whfsType: 'platform:publisher.lifecycle' },
    { whfsType: "http://www.webhare.net/xmlns/beta/test" }
  ], richdocfilelinkObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  test.eq(null, richdocfilelinkObjectProps.workflowEditor);
  test.eq({ seoTitle: true, description: true, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: true }, richdocfilelinkObjectProps.baseProperties);

  const imageContentLinkObjectProps = await describeMetaTabs(await getApplyTesterForObject(imageContentLink), { user: test.getUser("sysop").auth, mode: "objectProps" });
  test.eqPartial([
    { whfsType: 'platform:publisher.lifecycle' }
  ], imageContentLinkObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));

  test.eq(null, imageContentLinkObjectProps.workflowEditor);
  test.eq({ seoTitle: false, description: true, keywords: false, pageHeading: false, isUnlisted: false, requireTitle: false, seoTab: false }, imageContentLinkObjectProps.baseProperties);
  test.eqPartial([
    { whfsType: "platform:publisher.lifecycle" },
  ], imageContentLinkObjectProps.extendProps.toSorted((a, b) => a.extension.localeCompare(b.extension)));
  test.eqPartial([
    { namespace: "http://www.webhare.net/xmlns/webhare_testsuite/basetestprops" }
  ], imageContentLinkObjectProps.types.toSorted((a, b) => a.namespace.localeCompare(b.namespace)));
}

async function testOverrides() {
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const metaoverride1 = await tmpfolder.createFile("metaoverride1", { type: "platform:filetypes.richdocument" });
  await commitWork();

  { //metaoverride1
    const applytester = await getApplyTesterForObject(metaoverride1);
    const metatabs = await describeMetaTabs(applytester, { mode: "editor" });

    test.eqPartial({
      types: [
        {
          namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
          sections: [
            {
              title: ':WTS base test',
              fields: [
                {
                  name: "anyField",
                  title: ":Any field",
                  component: { textedit: { valueConstraints: { maxBytes: 4096 } } }
                }, {
                  name: "numberField",
                  constraints: {
                    valueType: "integer",
                    minValue: 0,
                    maxValue: 100
                  },
                  component: { textedit: { valueType: 'integer', suffix: "kg", emptyValue: 2 } }
                }, {
                  name: "whUser",
                  title: ":WH Usertje",
                  component: { textarea: {} }
                }, {
                  name: "rtd"
                }, {
                  name: "multiField"
                }, {
                  name: "checkIt"
                }, {
                  name: "extControlledField"
                }, {
                  name: "aLink",
                }
              ]
            }, {
              title: ":Folksonomy tags",
            },
          ]
        }
      ]
    }, metatabs);
  } //end metaoverride1
}

async function getMockTestApplyTester(name: string) {
  const testpages = await openFolder("site::webhare_testsuite.testsitejs/testpages");
  return await getApplyTesterForMockedObject(testpages, false, "platform:filetypes.richdocument", name);
}

async function testAllTypes() {
  const allpropsTabs = await describeMetaTabs(await getMockTestApplyTester("allprops"), { mode: "objectProps" });
  test.eq([":WTS base test", ":Folksonomy tags", ":WTS Generic", ":rich"], allpropsTabs?.types.map(t => t.sections.map(s => s.title)).flat());

  const wtsgenerictab = allpropsTabs!.types[1].sections[0];
  test.eqPartial({ title: ":str" }, wtsgenerictab.fields.find(_ => _.name === 'str'));
  test.eqPartial({ component: { fileedit: {} } }, wtsgenerictab.fields.find(_ => _.name === 'blub')); //TODO but shouldn't it actually be an image?
  test.eqPartial([
    { name: "blub", component: { fileedit: {} } },
    { name: "blubImg", component: { imgedit: {} } },
  ], wtsgenerictab.fields.filter(_ => _.name === 'blub' || _.name === 'blubImg'));
  test.eqPartial([
    { name: "aDateTime", component: { datetime: { type: "datetime", storeUTC: true } } },
    { name: "aDay", component: { datetime: { type: "date", storeUTC: false } } },
  ], wtsgenerictab.fields.filter(_ => _.name === 'aDateTime' || _.name === 'aDay'));

  const missingSuggestions = wtsgenerictab.fields.filter(_ => _.component?.text?.value && _.component?.text?.enabled === false);
  //TODO can we solve these all? at least prevent more from appearing
  test.eq(["aDoc", "aForm", "aHTMLDoc", "aRecord", "aTypedRecord", "anArray", "anInstance", "anUntypedRecord", "myLink", "strArray"], missingSuggestions.map(_ => _.name).sort());

  const manualTabs = await describeMetaTabs(await getMockTestApplyTester("manualtabs"), { mode: "objectProps" });
  // console.dir(manualTabs, { depth: 10 });
  test.eqPartial([
    { title: ":Tab 1", fields: [{ name: "anyField" }, { name: "numberField" }, { name: "whUser" }] },
    { title: ":Folksonomy tags", fields: [{ name: "folksonomy" }] },
    { title: "webhare_testsuite:webdesigns.basetestjs.tab2", fields: [{ name: "rtd" }, { name: "checkIt" }] }
  ], manualTabs?.types[0].sections);
}

test.runTests([
  () => test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
      marge: {},
    }
  }),
  testIgnoreMetatabsForOldContent,
  testMetadataReaderPermissions,
  testMetadataReader,
  testOverrides,
  testAllTypes
]);
