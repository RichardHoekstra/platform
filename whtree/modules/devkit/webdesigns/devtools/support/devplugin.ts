import { devkitDebugPath } from "@mod-platform/js/concepts/frontend";
import { getAssetBase } from "@webhare/env";
import type { PagePluginFunction, PagePluginRequest, PagePluginInit } from "@webhare/router";
import { parseYamlPluginConfig } from "@webhare/whfs";

interface DevPluginData {
  adddebugscript: boolean;
}

export function devSupportHook(init: PagePluginInit, composer: PagePluginRequest) {
  const config = parseYamlPluginConfig<DevPluginData>(init.settings);
  if (config.adddebugscript)
    composer.insertAt("dependencies-bottom", `<script src="${(getAssetBase() || '/') + devkitDebugPath.substring(1)}" type="module" crossorigin="anonymous"></script>`);
  // IF(IsRequest()) FIXME for DYNAMIC requets only,.
  //   webdesign->InsertWithCallback(PTR this->PrintUsedResources(webdesign), "body-devbottom");
}

devSupportHook satisfies PagePluginFunction;
