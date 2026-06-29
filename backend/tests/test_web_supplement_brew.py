from app.services.web_supplement import extract_search_queries


def test_brew_and_official_site_queries():
    text = (
        "先去 Node.js 官网下载，然后 brew install --cask cc-switch，"
        "再用 pip install requests 安装依赖。"
    )
    queries = extract_search_queries(text, "教程", style="beginner", max_queries=20)
    joined = " ".join(queries).lower()
    assert "brew install" in joined
    assert "pip install" in joined
    assert "官网" in joined or "node.js" in joined
