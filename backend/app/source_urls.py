"""来源站点的模型页面 URL。

库表只存 `source` + `repo_id` + `revision`（下载时的版本），页面地址由这里
统一拼，避免入库、回填、前端各写一套规则。拼不出就返回空串 —— 本地导入 /
Demo 没有远端页面，不猜。

`revision` 的含义各家不同：
- Hugging Face：分支 / tag / commit，`/tree/{revision}` 是精确版本页
- Civitai：`modelVersionId`，`?modelVersionId={id}` 是精确版本页
- ModelScope：分支 / tag，网页的版本页地址不稳定，落到模型主页最稳
"""
from __future__ import annotations


def source_page_url(source: str, repo_id: str, revision: str = "") -> str:
    rid = (repo_id or "").strip()
    if not rid:
        return ""
    rev = (revision or "").strip()

    if source == "huggingface":
        base = f"https://huggingface.co/{rid}"
        # main 是默认分支，仓库根页就是最新版；具体 commit/tag 才需要 /tree/
        return f"{base}/tree/{rev}" if rev and rev != "main" else base
    if source == "modelscope":
        return f"https://modelscope.cn/models/{rid}"
    if source == "civitai":
        base = f"https://civitai.com/models/{rid}"
        return f"{base}?modelVersionId={rev}" if rev.isdigit() else base
    if source == "github":
        return f"https://github.com/{rid}"
    return ""
