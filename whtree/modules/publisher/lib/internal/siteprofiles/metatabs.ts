import { getApplyTesterForMockedObject, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/describe";
import { openFileOrFolder, openFolder } from "@webhare/whfs";
import type { FieldLayout, ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent, type AnyTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";
import { toCamelCase, toSnakeCase, type ToSnakeCase, nameToSnakeCase } from "@webhare/std";
import type { CSPApplyRule, CSPContentType, CSPMember, CSPMemberOverride, CustomFieldsLayout } from "@webhare/whfs/src/siteprofiles";
import { parseYamlComponent } from "./parser";
import { getAuthorizationInterface, type AuthorizationInterface } from "@webhare/auth";
import { getPoliciesForObject, type PolicyMap } from "./fsobjectpolicy";

interface MetadataSection {
  title: string;
  fields: Array<{
    name: string;
    title: string;
    constraints: ValueConstraints | null;
    component: Record<string, unknown> & { text?: { value?: string; enabled?: boolean } }; //failed suggestions are converted to text: { value: { "Unable..."}, enabled: false}
    layout?: FieldLayout;
  }>;
}

const hsinfo = Symbol("hsinfo");

/** Editor configuration information */
interface MetaTabs {
  types: Array<{
    namespace: string;
    layout?: string[];
    sections: MetadataSection[];
    workflow: boolean;
  }>;
  extendProps: Array<{
    title: string;
    whfsType: string;
    extension: string;
    workflow: boolean;
  }>;
  /** Issues - for now simply strings */
  issues: string[];
  /** Whether a workflow editor is active */
  workflowEditor: Record<never, never> | null; //we'll be adding metadata about the editor in the future, so already make it an object
  baseProperties: {
    description: boolean;
    keywords: boolean;
    pageHeading: boolean;
    isUnlisted: boolean;
    requireTitle: boolean;
    seoTab: boolean;
    seoTitle: boolean;
  };
  /** Relevant policy objects */
  policies: PolicyMap;
}

interface MetaTabsWithHSInfo extends MetaTabs {
  //harescript info, used for HS metadata only
  [hsinfo]: unknown;
}


type ExtendProperties = CSPApplyRule["extendproperties"][0];

/** Calculate the tabs to render for this YAML SP layout: */
function determineLayout(matchtype: CSPContentType, layout: CustomFieldsLayout): Array<{
  title: string;
  members: CSPMember[];
}> {
  if (layout === "all")
    return [
      {
        title: "",
        members: matchtype.members || []
      }
    ];

  const inTabs = Array.isArray(layout) ? [{ title: "", layout }] : layout.tabs;

  const outtabs = [];
  const seen = new Set<string>;
  for (const tab of inTabs) {
    const outmembers = [];
    for (const field of tab.layout) {
      if (seen.has(field))
        continue; //eliminate duplicates

      seen.add(field);
      const member = matchtype.members?.find(_ => _.jsname === field);
      if (!member)
        continue; //skip if not found

      outmembers.push(member);
    }
    if (outmembers.length)
      outtabs.push({ title: tab.title, members: outmembers });
  }

  return outtabs;
}

function toYamlComponent(comp: NonNullable<CSPMember["component"]>, constraints: ValueConstraints | null): AnyTolliumComponent {
  const props = { ...toCamelCase(comp.yamlprops), valueConstraints: constraints };
  if (comp.ns === "http://www.webhare.net/xmlns/tollium/screens")
    return { [comp.component]: props };
  else
    return { [`${comp.ns}#${comp.component}`]: props };
}

function determineComponent(constraints: ValueConstraints | null, setComponent: CSPMember["component"]): AnyTolliumComponent {
  if (setComponent)
    return toYamlComponent(setComponent, constraints ?? {});

  const suggestion = constraints && suggestTolliumComponent(constraints);
  return suggestion?.component ?? {
    text: {
      value: suggestion?.error ?? 'Unable to suggest a component',
      enabled: false
    }
  };
}

async function getFilteredExtendProps(applytester: WHFSApplyTester, user: AuthorizationInterface | undefined, editWorkflowMetadata: boolean, editNonWorkflowMetadata: boolean, editNonCloneOnCopy: boolean): Promise<Pick<MetaTabs, 'extendProps' | 'issues'>> {
  const extendProps: MetaTabs['extendProps'] = [];
  const issues: string[] = [];

  for (const prop of await applytester.getExtendProps()) {
    if (prop.requireRight && (!user || !await user.hasRightOn(prop.requireRight, applytester.getRightsTarget() ?? "all"))) {
      issues.push(`No rights to extendProps editor for type ${prop.whfsType}`);
      continue;
    }

    if (!prop.whfsType) {
      issues.push(`Not considering property editor '${prop.extension}' without a whfsType`);
      continue; //when not working for objectprops we require a type
    }

    const matchtype = getType(prop.whfsType);
    if (!matchtype) {
      issues.push(`No such type ${prop.whfsType}`);
      continue;
    }

    if (matchtype.workflow && !editWorkflowMetadata) {
      issues.push(`Type ${prop.whfsType} is defined for workflow, but this context cannot edit workflow controlled fields`);
      continue;
    }

    if (!matchtype.workflow && !editNonWorkflowMetadata) {
      issues.push(`Type ${prop.whfsType} is not defined for workflow, but this context requires workflow`);
      continue;
    }
    if (!matchtype.cloneoncopy && !matchtype.cloneonarchive && !editNonCloneOnCopy) {
      issues.push(`Type ${prop.whfsType} is not cloneOnCopy or cloneOnArchive, may not be shown in versions context`);
      continue;
    }

    extendProps.push({
      whfsType: prop.whfsType,
      extension: prop.extension,
      title: matchtype.title || `:${matchtype.scopedtype || matchtype.namespace}`,
      workflow: matchtype.workflow
    });
  }
  return { extendProps, issues };
}

/** Describe configuration for an editor
 * @param options.mode - Mode to determine which metadata tabs to describe
 * @param user - User used for rights checks
 */
export async function describeMetaTabs(applytester: WHFSApplyTester, options: {
  mode: "editor" | "objectProps" | "versions" | "all";
  user?: AuthorizationInterface;
}): Promise<MetaTabs> {
  const cf = await applytester.__getCustomFields();
  const pertype: Record<string, ExtendProperties[]> = {};

  //First gather all rules per type in their apply order
  for (const rule of cf.extendprops)
    for (const extend of rule.extendproperties) {
      pertype[extend.contenttype] ||= [];
      pertype[extend.contenttype].push(extend);
    }

  //Find out if we have a workflow editor (documenteditor supporting Publish and Save, which implies workflow fields move from objectprops to the editor)
  const setContentEditor = await applytester.getObjectEditor();

  const baseProps = await applytester.getBaseProperties();
  const needsTemplate = applytester.isTypeNeedsTemplate();

  // objectprops is not allowed to edit workflow fields when editing existing files which have a document editor
  const editWorkflowMetadata = applytester.isMocked() || options.mode !== "objectProps" || !setContentEditor?.documentEditor;
  const editNonWorkflowMetadata = options.mode !== "editor";
  const editNonCloneOnCopy = options.mode !== "versions";
  const aboutExtendProps = await getFilteredExtendProps(applytester, options?.user, editWorkflowMetadata, editNonWorkflowMetadata, editNonCloneOnCopy);
  const metasettings: MetaTabsWithHSInfo = {
    types: [],
    extendProps: aboutExtendProps.extendProps,
    issues: aboutExtendProps.issues,
    [hsinfo]: applytester.__getHSInfo(),
    workflowEditor: null,
    policies: await getPoliciesForObject(applytester, ["getFallbackMetaTitle"]),
    baseProperties: {
      description: baseProps.description,
      keywords: baseProps.keywords,
      seoTitle: needsTemplate && baseProps.seotitle,
      pageHeading: needsTemplate && baseProps.pageheading,
      isUnlisted: baseProps.isunlisted,
      requireTitle: baseProps.requiretitle,
      seoTab: baseProps.seotab,
    }
  };


  if (setContentEditor?.documentEditor)
    metasettings.workflowEditor = {};

  for (const [contenttype, extendproperties] of Object.entries(pertype)) {
    const matchtype = getType(contenttype);
    if (!matchtype) {
      metasettings.issues.push(`No such type ${contenttype}`);
      continue;
    }
    if (!matchtype?.yaml) {
      metasettings.issues.push(`Type ${contenttype} must be defined by a YAML siteprofile`);
      continue;
    }
    if (matchtype.workflow && !editWorkflowMetadata) {
      metasettings.issues.push(`Type ${contenttype} is defined for workflow, but this context cannot edit workflow controlled fields`);
      continue;
    }
    if (!matchtype.workflow && !editNonWorkflowMetadata) {
      metasettings.issues.push(`Type ${contenttype} is not defined for workflow, but this context requires workflow`);
      continue;
    }
    if (!matchtype.cloneoncopy && !matchtype.cloneonarchive && !editNonCloneOnCopy) {
      metasettings.issues.push(`Type ${contenttype} is not cloneOnCopy or cloneOnArchive, may not be shown in versions context`);
      continue;
    }

    let lastlayout: CustomFieldsLayout | undefined;
    const overrides: Record<string, CSPMemberOverride> = {};

    for (const extend of extendproperties) {
      if (extend.layout)
        lastlayout = extend.layout;

      if (extend.override) //can't blindly assign, need to go through each member ...
        for (const [name, override] of extend.override) {
          if (!overrides[name]) {
            overrides[name] = structuredClone(override);
            continue; //just copy, no override yet
          }

          if (override.component) //and overwrite / merge what we see there
            overrides[name].component = override.component;
          if (override.props)
            overrides[name].props = { ...overrides[name].props, ...override.props };
          if (override.title !== undefined)
            overrides[name].title = override.title;
          if (override.constraints)
            overrides[name].constraints = overrides[name].constraints ? mergeConstraints(overrides[name].constraints!, override.constraints) : override.constraints;
        }
    }

    if (!lastlayout) {
      metasettings.issues.push(`Type ${contenttype} has no layout applied`);
      continue; //no layout received, nothing to show
    }

    //gather the members to display
    const sections: MetadataSection[] = [];

    for (const tab of determineLayout(matchtype, lastlayout)) { //for every tab in the layout
      const section: MetadataSection = { //prepare the section. we may still discard this tab if all fields are layout: section
        title: tab.title || matchtype.title || matchtype.scopedtype || matchtype.namespace,
        fields: []
      };
      sections.push(section);

      for (const member of tab.members) { // for every member in the tab
        const override = overrides[member.jsname!]; //has to exist as we wouldn't be processing non-yaml types
        const constraints = mergeConstraints(member.constraints ?? null, override?.constraints ?? null);

        const component = determineComponent(constraints, override?.component ?? member.component);
        if (override?.props) {
          const compname: string = Object.keys(component)[0];
          component[compname] = { ...component[compname]!, ...toCamelCase(override.props) };
        }

        const fieldTitle = override?.title || member.title || (":" + member.jsname!);
        const useLayout = override?.layout || member.layout;

        let addtoSection = section; //to which section we'll add (either 'section' or a separate tab)
        if (useLayout === 'section') {
          addtoSection = { title: fieldTitle, fields: [] };
          sections.push(addtoSection);
        }

        addtoSection.fields.push({
          name: member.jsname!,
          title: override?.title || member.title || (":" + member.jsname!),
          layout: useLayout,
          constraints,
          component
        });
      }
    }

    metasettings.types.push({
      namespace: matchtype.namespace,
      sections: sections.filter(section => section.fields.length > 0),
      workflow: matchtype.workflow,
    });
  }

  return metasettings;
}

interface MetaTabsForHS {
  types: Array<{
    namespace: string;
    sections: Array<{
      title: string;
      fields: Array<{
        name: string;
        title: string;
        constraints: ToSnakeCase<ValueConstraints> | null;
        component: {
          ns: string;
          component: string;
          yamlprops: unknown;
        };
      }>;
    }>;
    workflow: boolean;
  }>;
  __hsinfo: unknown;
  issues: string[];
  extend_props: ToSnakeCase<MetaTabs['extendProps']>;
  //TODO do we need this? just inform the objecteditor about baseprops/edit_workflow_metadata
  workfloweditor: Record<never, never> | null;
  base_properties: ToSnakeCase<MetaTabs['baseProperties']>;
  policies: ToSnakeCase<PolicyMap>;
}

export function remapForHs(metatabs: MetaTabs): MetaTabsForHS {
  const translated: MetaTabsForHS = {
    types: metatabs.types.map(type => ({
      ...type,
      sections: type.sections.map(section => ({
        title: section.title,
        fields: section.fields.map(field => ({
          ...field,
          name: nameToSnakeCase(field.name),
          constraints: toSnakeCase(field.constraints),
          component: parseYamlComponent(field)! //here we only use it to convert 'component', never line(s)
        }))
      }))
    })),
    workfloweditor: metatabs.workflowEditor,
    __hsinfo: (metatabs as MetaTabsWithHSInfo)[hsinfo],
    issues: metatabs.issues,
    extend_props: toSnakeCase(metatabs.extendProps),
    base_properties: toSnakeCase(metatabs.baseProperties),
    policies: toSnakeCase(metatabs.policies)
  };
  return translated;
}

export async function describeMetaTabsForHS(obj: { objectid: number; parent: number; isfolder: boolean; type: number; mode: "editor" | "objectProps" | "versions"; user: number }): Promise<MetaTabsForHS | null> {
  let applytester;
  if (obj.objectid) {
    applytester = await getApplyTesterForObject(await openFileOrFolder(obj.objectid, { allowHistoric: true }));
  } else {
    const typens = getType(obj.type, obj.isfolder ? "folderType" : "fileType")?.namespace ?? (obj.isfolder ? "platform:foldertypes.default" as const : "platform:filetypes.unknown" as const);
    applytester = await getApplyTesterForMockedObject(await openFolder(obj.parent, { allowRoot: true }), obj.isfolder, typens);
  }

  const metatabs = await describeMetaTabs(applytester, { mode: obj.mode, user: obj.user ? getAuthorizationInterface(obj.user) : undefined });
  return remapForHs(metatabs);
}
