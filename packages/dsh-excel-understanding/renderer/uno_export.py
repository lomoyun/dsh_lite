"""此脚本只在 bubblewrap 内运行；从不保存改写后的工作簿。"""
import json
from pathlib import Path
import subprocess
import time
import uuid
import uno
from com.sun.star.beans import PropertyValue

MAX_PAGES = 12


def prop(name, value):
    result = PropertyValue()
    result.Name = name
    result.Value = value
    return result


def connect(pipe):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    for _ in range(100):
        try:
            return resolver.resolve(f"uno:pipe,name={pipe};urp;StarOffice.ComponentContext")
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("LibreOffice 启动超时")


def select_sheet(document, request):
    sheets = document.getSheets()
    selected = sheets.getByName(request["sheet"])
    selected.IsVisible = True
    document.getCurrentController().setActiveSheet(selected)
    for name in sheets.getElementNames():
        if name != request["sheet"]:
            sheets.getByName(name).IsVisible = False
    if request.get("range"):
        area = selected.getCellRangeByName(request["range"]).getRangeAddress()
        selected.setPrintAreas((area,))
    return selected


def export(document, request):
    document.enableAutomaticCalculation(False)
    select_sheet(document, request)
    filters = (prop("PageRange", f"1-{MAX_PAGES}"), prop("ExportBookmarks", False),
               prop("ExportFormFields", False), prop("ExportNotes", False))
    document.storeToURL("file:///output/preview.pdf", (
        prop("FilterName", "calc_pdf_Export"), prop("FilterData", filters), prop("Overwrite", True)))
    info = subprocess.check_output(["pdfinfo", "/output/preview.pdf"], text=True)
    pages = int(next(line.split(":")[1] for line in info.splitlines() if line.startswith("Pages:")))
    subprocess.run(["pdftoppm", "-png", "-scale-to", "1600", "-f", "1", "-l", str(MAX_PAGES),
                    "/output/preview.pdf", "/output/page"], check=True, stdout=subprocess.DEVNULL)
    manifest = {"pages": pages, "limited": pages >= MAX_PAGES,
                "warning": "预览由 LibreOffice 生成，可能重算或改变分页；原始解析值未覆盖。"}
    Path("/output/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))


def main():
    request = json.loads(Path("/input/request.json").read_text())
    pipe = "excel_" + uuid.uuid4().hex
    office = subprocess.Popen(["libreoffice", "--headless", "--nologo", "--nodefault", "--norestore",
                               "-env:UserInstallation=file:///tmp/lo-profile",
                               f"--accept=pipe,name={pipe};urp;StarOffice.ServiceManager"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    document = None
    try:
        context = connect(pipe)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        options = (prop("Hidden", True), prop("ReadOnly", True), prop("MacroExecutionMode", 0),
                   prop("UpdateDocMode", 0), prop("AskUpdate", False))
        document = desktop.loadComponentFromURL("file:///input/" + request["filename"], "_blank", 0, options)
        if document is None:
            raise RuntimeError("工作簿未能打开")
        export(document, request)
    finally:
        if document:
            document.close(True)
        office.terminate()


if __name__ == "__main__":
    main()
