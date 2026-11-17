"""节点发现 / 节点管理：清单归一化、已装识别、缺节点检测。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import nodes
from app.comfy import installer


def entry(title: str, ref: str, *, install_type: str = "git-clone", description: str = "") -> dict:
    return {
        "title": title,
        "author": ref.split("/")[-2] if "/" in ref else "someone",
        "reference": ref,
        "description": description,
        "install_type": install_type,
        "files": [ref],
    }


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    """把清单指向临时文件，并清空内存索引，避免用例之间串数据。"""

    def install(entries: list[dict], node_map: dict[str, list]) -> None:
        cnl = tmp_path / "custom-node-list.json"
        cnl.write_text(json.dumps({"custom_nodes": entries}), encoding="utf-8")
        mapping = tmp_path / "extension-node-map.json"
        mapping.write_text(json.dumps(node_map), encoding="utf-8")
        monkeypatch.setattr(nodes, "CNL_PATH", cnl)
        monkeypatch.setattr(nodes, "NODE_MAP_PATH", mapping)
        custom = tmp_path / "custom_nodes"
        custom.mkdir(exist_ok=True)
        monkeypatch.setattr(nodes, "WORKSPACE_CUSTOM_NODES_DIR", custom)
        with nodes._lock:
            nodes._cache.update(
                {"at": 0.0, "items": [], "by_id": {}, "owner": {}, "core": set(), "classes": {}, "repo_classes": {}}
            )
        nodes.catalog()

    return install


def write_node(root: Path, name: str, remote: str = "", files: dict[str, str] | None = None) -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    if remote:
        git = directory / ".git"
        git.mkdir()
        (git / "config").write_text(
            '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ' + remote + "\n\tfetch = +refs/heads/*\n",
            encoding="utf-8",
        )
        (git / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        refs = git / "refs" / "heads"
        refs.mkdir(parents=True)
        (refs / "main").write_text("abcdef1234567890\n", encoding="utf-8")
    for rel, text in (files or {}).items():
        target = directory / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return directory


# ---------------- 地址归一化 ----------------
def test_norm_strips_scheme_git_and_case():
    assert nodes._norm("https://GitHub.com/Foo/Bar.git/") == "github.com/foo/bar"
    assert nodes._norm("http://www.github.com/foo/bar") == "github.com/foo/bar"
    assert nodes._norm("") == ""


def test_slug_keeps_owner_and_repo():
    assert nodes._slug("https://github.com/ltdrdata/ComfyUI-Impact-Pack") == "ltdrdata/comfyui-impact-pack"
    # 带 /tree/main 的地址必须归到同一个 id，否则去重与已装识别会分裂
    assert nodes._slug("https://github.com/ltdrdata/ComfyUI-Impact-Pack/tree/main") == "ltdrdata/comfyui-impact-pack"


def test_dir_name_is_safe():
    assert nodes._dir_name("https://github.com/rgthree/rgthree-comfy.git") == "rgthree-comfy"
    assert nodes._dir_name("https://gitee.com/a/b c") == "b-c"


# ---------------- 清单构建 ----------------
def test_build_dedupes_and_flags_install_type(catalog):
    catalog(
        [
            entry("A", "https://github.com/o/a"),
            entry("A duplicate", "https://github.com/o/a.git"),
            entry("Copy only", "https://example.com/dir", install_type="copy"),
        ],
        {"https://github.com/o/a": [["A1", "A2"]]},
    )
    items = nodes.catalog()["items"]
    # 非 git 站点的 id 带上域名，避免不同来源的同名目录撞车
    assert [it["id"] for it in items] == ["o/a", "example.com/dir"]
    assert items[0]["node_count"] == 2
    assert items[0]["installable"] is True
    # copy / unzip 类型的来源不可控，不允许一键装
    assert items[1]["installable"] is False


def test_owner_index_uses_full_class_list(catalog):
    """展示只放前 10 个类名，但反查必须用完整清单（第 11 个也要能查到）。"""
    classes = [f"Node{i}" for i in range(15)]
    catalog([entry("Big", "https://github.com/o/big")], {"https://github.com/o/big": [classes]})
    data = nodes.catalog()
    assert len(data["by_id"]["o/big"]["nodes"]) == 10
    assert data["owner"]["Node14"] == "o/big"


def test_core_repo_classes_are_not_owners(catalog):
    node_map = {
        "https://github.com/comfyanonymous/ComfyUI": [["KSampler", "CLIPTextEncode"]],
        "https://github.com/o/x": [["KSampler"]],
    }
    catalog([entry("X", "https://github.com/o/x")], node_map)
    data = nodes.catalog()
    assert data["core"] == {"KSampler", "CLIPTextEncode"}
    # 核心节点不归属任何扩展，否则会被提示「装个扩展来获得 KSampler」
    assert "KSampler" not in data["owner"]


# ---------------- 搜索 ----------------
def test_search_matches_node_class_names(catalog):
    """用户搜 SAM 时应该能从节点类名找到扩展，而不是只匹配标题。"""
    catalog(
        [
            entry("Segment Anything", "https://github.com/o/segment", description="prompt helper"),
            entry("Other", "https://github.com/o/other"),
        ],
        {
            "https://github.com/o/segment": [["SAMLoader", "GroundingDinoSAMSegment"]],
            "https://github.com/o/other": [["KSamplerExtra"]],
        },
    )
    got = nodes.search("samloader")
    assert [it["id"] for it in got["items"]] == ["o/segment"]


def test_search_sorts_by_node_count_and_paginates(catalog):
    catalog(
        [entry(f"N{i}", f"https://github.com/o/n{i}") for i in range(3)],
        {
            "https://github.com/o/n0": [["A"]],
            "https://github.com/o/n1": [["A", "B", "C"]],
            "https://github.com/o/n2": [["A", "B"]],
        },
    )
    first = nodes.search("", sort="nodes", limit=2, page=1)
    assert [it["id"] for it in first["items"]] == ["o/n1", "o/n2"]
    assert first["total"] == 3 and first["done"] is False
    second = nodes.search("", sort="nodes", limit=2, page=2)
    assert [it["id"] for it in second["items"]] == ["o/n0"]
    assert second["done"] is True


def test_search_scope_filters_installed(catalog, tmp_path):
    catalog(
        [entry("A", "https://github.com/o/a"), entry("B", "https://github.com/o/b")],
        {"https://github.com/o/a": [["A1"]], "https://github.com/o/b": [["B1"]]},
    )
    write_node(tmp_path / "custom_nodes", "a", remote="https://github.com/o/a.git")
    assert [it["id"] for it in nodes.search("", scope="installed")["items"]] == ["o/a"]
    assert [it["id"] for it in nodes.search("", scope="available")["items"]] == ["o/b"]


# ---------------- 已装识别 ----------------
def test_installed_reads_git_remote_and_marks_disabled(catalog, tmp_path):
    catalog([entry("A", "https://github.com/o/a")], {"https://github.com/o/a": [["A1"]]})
    root = tmp_path / "custom_nodes"
    write_node(root, "a", remote="https://github.com/o/a.git")
    write_node(root, "b.disabled", remote="https://github.com/o/b.git")
    rows = {row["dir"]: row for row in nodes.installed()}
    assert rows["a"]["id"] == "o/a" and rows["a"]["tracked"] is True
    assert rows["a"]["disabled"] is False
    assert rows["b.disabled"]["name"] == "b" and rows["b.disabled"]["disabled"] is True
    # 清单里没有的仓库也要列出来，只是标成未收录
    assert rows["b.disabled"]["tracked"] is False


def test_installed_falls_back_to_static_scan(catalog, tmp_path):
    """未收录的节点：静态扫 NODE_CLASS_MAPPINGS，不执行代码。"""
    catalog([], {})
    root = tmp_path / "custom_nodes"
    write_node(
        root,
        "custom",
        remote="https://github.com/o/custom.git",
        files={"__init__.py": 'NODE_CLASS_MAPPINGS = {\n    "MyNode": MyNode,\n}\n'},
    )
    row = nodes.installed()[0]
    assert row["node_count"] == 1
    assert row["nodes"] == ["MyNode"]


def test_pick_dir_avoids_existing_and_disabled(catalog, tmp_path):
    catalog([], {})
    root = tmp_path / "custom_nodes"
    (root / "pack").mkdir()
    (root / "pack-2.disabled").mkdir()
    assert nodes._pick_dir("https://github.com/o/pack") == "pack-3"


# ---------------- 缺节点检测 ----------------
def ui_workflow(types: list[str]) -> dict:
    return {"nodes": [{"id": i, "type": t} for i, t in enumerate(types)], "links": []}


def test_extract_classes_ignores_slot_types_and_uuid():
    payload = {
        "nodes": [{"type": "KSampler"}, {"type": "Note"}, {"type": "Reroute"}],
        "definitions": {
            "subgraphs": [
                {
                    "nodes": [{"type": "MySubNode"}],
                    # 槽位定义里的 type 是数据类型标注，不是节点
                    "inputs": [{"name": "clip", "type": "CLIP"}],
                }
            ]
        },
    }
    assert nodes.extract_classes(payload) == {"KSampler", "MySubNode"}


def test_extract_classes_supports_api_format():
    payload = {"prompt": {"3": {"class_type": "KSampler", "inputs": {}}, "4": {"class_type": "VAEDecode"}}}
    assert nodes.extract_classes(payload) == {"KSampler", "VAEDecode"}


def test_missing_reports_providers_and_skips_core(catalog, tmp_path, monkeypatch):
    catalog(
        [entry("Impact", "https://github.com/o/impact")],
        {
            "https://github.com/comfyanonymous/ComfyUI": [["KSampler", "CLIPTextEncode"]],
            "https://github.com/o/impact": [["SAMLoader", "Detailer"]],
        },
    )
    flows = tmp_path / "workflows"
    flows.mkdir()
    (flows / "a.json").write_text(
        json.dumps(ui_workflow(["KSampler", "CLIPTextEncode", "SAMLoader", "Detailer", "Mystery"])),
        encoding="utf-8",
    )
    monkeypatch.setattr(nodes, "WORKSPACE_WORKFLOWS_DIR", flows)

    got = nodes.missing()
    report = got["workflows"][0]
    # 核心节点不缺，第三方节点归到 Impact，认不出的单列
    assert report["missing"] == 3
    assert [p["id"] for p in report["providers"]] == ["o/impact"]
    assert report["providers"][0]["covers"] == ["Detailer", "SAMLoader"]
    assert report["unknown"] == ["Mystery"]
    assert got["providers"][0]["files"] == 1


def test_missing_skips_installed_and_disabled(catalog, tmp_path, monkeypatch):
    catalog(
        [entry("Impact", "https://github.com/o/impact")],
        {"https://github.com/o/impact": [["SAMLoader"]]},
    )
    root = tmp_path / "custom_nodes"
    write_node(root, "impact", remote="https://github.com/o/impact.git")
    flows = tmp_path / "workflows"
    flows.mkdir()
    (flows / "a.json").write_text(json.dumps(ui_workflow(["SAMLoader"])), encoding="utf-8")
    monkeypatch.setattr(nodes, "WORKSPACE_WORKFLOWS_DIR", flows)

    assert nodes.missing()["missing_files"] == 0

    # 禁用后（.disabled 后缀）等于没装，应该重新报缺
    (root / "impact").rename(root / "impact.disabled")
    assert nodes.missing()["missing_files"] == 1


def test_missing_recognizes_display_names_from_installed_nodes(catalog, tmp_path, monkeypatch):
    """rgthree 这类节点 workflow 里存的是显示名，静态扫要能把显示名也收进来。"""
    catalog([], {})
    root = tmp_path / "custom_nodes"
    write_node(
        root,
        "rgthree",
        remote="https://github.com/rgthree/rgthree-comfy.git",
        files={
            "__init__.py": (
                'NODE_CLASS_MAPPINGS = {"RgthreePowerLoraLoader": X}\n'
                'NODE_DISPLAY_NAME_MAPPINGS = {"RgthreePowerLoraLoader": "Power Lora Loader (rgthree)"}\n'
            )
        },
    )
    flows = tmp_path / "workflows"
    flows.mkdir()
    (flows / "a.json").write_text(json.dumps(ui_workflow(["Power Lora Loader (rgthree)"])), encoding="utf-8")
    monkeypatch.setattr(nodes, "WORKSPACE_WORKFLOWS_DIR", flows)
    assert nodes.missing()["missing_files"] == 0


def test_missing_resolves_display_names_via_nodename_pattern(catalog, tmp_path, monkeypatch):
    """未安装的扩展要靠清单里的 nodename_pattern 把显示名反查回仓库。

    真实案例：rgthree 在画布里存的是 `Power Lora Loader (rgthree)`，
    而 extension-node-map 里只有类名 `RgthreePowerLoraLoader`。
    没有这一步，这类节点只能标「查不到归属」，用户不知道装哪个包。
    """
    catalog(
        [entry("rgthree's ComfyUI Nodes", "https://github.com/rgthree/rgthree-comfy")],
        {
            "https://github.com/rgthree/rgthree-comfy": [
                ["RgthreePowerLoraLoader", "RgthreePowerPrompt"],
                {"nodename_pattern": " \\(rgthree\\)$"},
            ]
        },
    )
    flows = tmp_path / "workflows"
    flows.mkdir()
    (flows / "a.json").write_text(
        json.dumps(ui_workflow(["RgthreePowerPrompt", "Power Lora Loader (rgthree)"])),
        encoding="utf-8",
    )
    monkeypatch.setattr(nodes, "WORKSPACE_WORKFLOWS_DIR", flows)

    report = nodes.missing()["workflows"][0]
    assert report["unknown"] == []
    assert [p["id"] for p in report["providers"]] == ["rgthree/rgthree-comfy"]
    # 类名走 owner 索引、显示名走 pattern，两条都要归到这个包
    assert sorted(report["providers"][0]["covers"]) == ["Power Lora Loader (rgthree)", "RgthreePowerPrompt"]


def test_missing_ignores_already_installed_pattern_match(catalog, tmp_path, monkeypatch):
    """pattern 命中的仓库已经装了，就不该再报缺（本地静态扫可能漏掉藏在子目录里的映射）。"""
    catalog(
        [entry("rgthree", "https://github.com/rgthree/rgthree-comfy")],
        {"https://github.com/rgthree/rgthree-comfy": [["RgthreePowerLoraLoader"], {"nodename_pattern": " \\(rgthree\\)$"}]},
    )
    root = tmp_path / "custom_nodes"
    write_node(root, "rgthree", remote="https://github.com/rgthree/rgthree-comfy.git", files={"__init__.py": "x = 1\n"})
    flows = tmp_path / "workflows"
    flows.mkdir()
    (flows / "a.json").write_text(json.dumps(ui_workflow(["Power Lora Loader (rgthree)"])), encoding="utf-8")
    monkeypatch.setattr(nodes, "WORKSPACE_WORKFLOWS_DIR", flows)

    assert nodes.missing()["missing_files"] == 0


# ---------------- 管理动作 ----------------
def test_toggle_renames_dir(catalog, tmp_path, monkeypatch):
    catalog([], {})
    from app.comfy import runner

    monkeypatch.setattr(runner, "active", lambda: None)
    write_node(tmp_path / "custom_nodes", "pack", remote="https://github.com/o/pack.git")
    assert nodes.toggle("pack") == {"dir": "pack.disabled", "disabled": True}
    assert nodes.toggle("pack.disabled") == {"dir": "pack", "disabled": False}


def test_toggle_refuses_while_instance_running(catalog, tmp_path, monkeypatch):
    catalog([], {})
    from app.comfy import runner

    monkeypatch.setattr(runner, "active", lambda: {"name": "v1"})
    write_node(tmp_path / "custom_nodes", "pack", remote="https://github.com/o/pack.git")
    with pytest.raises(Exception) as err:
        nodes.toggle("pack")
    assert "正在运行" in str(err.value)


def test_safe_dir_rejects_traversal(catalog, tmp_path):
    catalog([], {})
    for bad in ("", "..", "../etc", ".tmp-abc", "a/b"):
        with pytest.raises(Exception):
            nodes._safe_dir(bad)


def test_remove_deletes_dir(catalog, tmp_path, monkeypatch):
    catalog([], {})
    from app.comfy import runner

    monkeypatch.setattr(runner, "active", lambda: None)
    write_node(tmp_path / "custom_nodes", "pack", remote="https://github.com/o/pack.git")
    assert nodes.remove("pack") == {"deleted": "pack"}
    assert not (tmp_path / "custom_nodes" / "pack").exists()


# ---------------- 依赖通道泛化 ----------------
def test_filtered_requirements_accepts_custom_source(tmp_path):
    """节点自己的 requirements 要独立成文件，且 torch 仍然被剔除。"""
    env = tmp_path / "env"
    env.mkdir()
    comfy = tmp_path / "ComfyUI"
    comfy.mkdir()
    (comfy / "requirements.txt").write_text("numpy\n", encoding="utf-8")
    spec = installer.InstallSpec(name="x", workspace=tmp_path, environment=env, torch_channel="")
    node_req = tmp_path / "requirements.txt"
    node_req.write_text("torch>=2\ntorchvision\ninsightface==0.7.3\n", encoding="utf-8")

    path = installer.write_filtered_requirements(spec, node_req, "requirements.node-x.txt")
    kept = path.read_text(encoding="utf-8").split()
    assert kept == ["insightface==0.7.3"]
    assert path.name == "requirements.node-x.txt"
    # 默认参数仍然指向 ComfyUI 自己的清单，老路径不受影响
    assert installer.write_filtered_requirements(spec).read_text(encoding="utf-8").split() == ["numpy"]


def test_marker_is_per_cache_key(tmp_path):
    env = tmp_path / "env"
    env.mkdir()
    spec = installer.InstallSpec(name="x", workspace=tmp_path, environment=env, torch_channel="")
    base = env / "cache"
    base.mkdir()
    (base / "requirements.comfy.txt").write_text("a\n", encoding="utf-8")
    (base / "requirements.node-x.txt").write_text("b\n", encoding="utf-8")

    comfy_marker, comfy_fp = installer._requirements_marker(spec)
    node_marker, node_fp = installer._requirements_marker(
        spec, base / "requirements.node-x.txt", "requirements.node-x.done"
    )
    assert comfy_marker.name == "requirements.done"
    assert node_marker.name == "requirements.node-x.done"
    assert comfy_fp != node_fp


def test_node_catalog_uses_github_proxy(monkeypatch):
    """节点清单在 GitHub raw 上，跟着 github 源的代理开关走。

    过去它永远直连：5.7MB 在窄链路上要几分钟，而同一时刻下载却走代理。
    """
    import httpx as _httpx

    from app import nodes

    seen = {}
    monkeypatch.setattr(
        nodes, "load_settings", lambda: {"sources": {"github": {"proxy_enabled": True}}, "proxy": {"host": "127.0.0.1", "port": 7890}}
    )
    monkeypatch.setattr(nodes, "source_proxy", lambda cfg: "http://127.0.0.1:7890")

    def fake_get(url, **kw):
        seen.update(kw)
        return _httpx.Response(200, json={})

    monkeypatch.setattr(nodes.httpx, "get", fake_get)
    nodes._fetch(nodes.CNL_URL)

    assert seen.get("proxy") == "http://127.0.0.1:7890"
