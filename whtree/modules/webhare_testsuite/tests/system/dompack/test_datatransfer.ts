import * as test from "@mod-system/js/wh/testframework";
import * as pointer from "dompack/testframework/pointer";

test.runTests(
  [
    "Datatransfer object",
    async function () {
      const dragDataStore = new pointer.SimulatedDragDataStore(null);
      const dt = dragDataStore.dataTransfer;
      test.assert(dt instanceof DataTransfer);
      dt.effectAllowed = "linkMove";
      test.eq("linkMove", dt.effectAllowed);

      dt.dropEffect = "copy";
      test.eq("copy", dt.dropEffect);

      dt.setData("x-webhare/yeey", "str");
      test.eq("str", dt.getData("x-webhare/yeey"));
      test.eq(1, dt.items.length);
      test.eq("string", dt.items[0].kind);
      test.eq("x-webhare/yeey", dt.items[0].type);

      test.eq(1, dt.types.length);
      test.eq("x-webhare/yeey", dt.types[0]);
      test.eq(0, dt.files.length);

      dt.clearData("does-not-exist");
      dt.items.add("str", "second/item");
      test.eq(2, dt.items.length);
      dt.clearData("second/item");
      test.eq(1, dt.items.length);
      dt.clearData();
      test.eq(0, dt.items.length);

      dragDataStore.addFile(new File(["test"], "testfile.txt", { type: 'text/plain' }));
      test.eq(1, dt.items.length);
      test.eq(1, dt.files.length);
      test.eq("testfile.txt", dt.files[0].name);
      test.eq("file", dt.items[0].kind);
      test.eq("text/plain", dt.items[0].type);
      test.assert(dt.items[0].webkitGetAsEntry());
      test.assert(Array.from(dt.types).includes("Files"));
    }
  ]);
