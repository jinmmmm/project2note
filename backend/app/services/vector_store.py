import logging

from app.config import settings

logger = logging.getLogger(__name__)

_chromadb = None
_client = None


def _get_client():
    global _chromadb, _client
    if _client is not None:
        return _client
    try:
        import chromadb
        _chromadb = chromadb
        _client = chromadb.PersistentClient(path=str(settings.chroma_path))
        return _client
    except ImportError:
        logger.warning("chromadb 未安装，AI 问答 RAG 功能不可用。见 README 可选依赖安装说明。")
        return None
    except Exception as e:
        logger.warning("ChromaDB 初始化失败: %s", e)
        return None


class VectorStore:
    def _collection_name(self, task_id: str) -> str:
        return f"task_{task_id.replace('-', '_')}"

    def index_task(self, task_id: str, transcript_segments: list, markdown: str, meta: dict):
        client = _get_client()
        if not client:
            return

        col_name = self._collection_name(task_id)
        try:
            client.delete_collection(col_name)
        except Exception:
            pass

        collection = client.create_collection(col_name)
        documents, metadatas, ids = [], [], []

        for i, seg in enumerate(transcript_segments):
            documents.append(seg["text"])
            metadatas.append({
                "source_type": "transcript",
                "start_time": seg["start"],
                "end_time": seg["end"],
            })
            ids.append(f"tr_{i}")

        current_section = "概述"
        for i, line in enumerate(markdown.split("\n")):
            if line.startswith("## "):
                current_section = line[3:].strip()
            elif line.strip():
                documents.append(line)
                metadatas.append({"source_type": "markdown", "section_title": current_section})
                ids.append(f"md_{i}")

        if meta.get("title"):
            documents.append(f"标题: {meta['title']}")
            metadatas.append({"source_type": "meta"})
            ids.append("meta_0")

        if documents:
            collection.add(documents=documents, metadatas=metadatas, ids=ids)

    def query(self, task_id: str, question: str, n: int = 5) -> list:
        client = _get_client()
        if not client:
            return []

        col_name = self._collection_name(task_id)
        try:
            collection = client.get_collection(col_name)
        except Exception:
            return []
        results = collection.query(query_texts=[question], n_results=n)
        chunks = []
        if results and results.get("documents"):
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i] if results.get("metadatas") else {}
                chunks.append({"text": doc, "metadata": meta})
        return chunks

    def delete(self, task_id: str):
        client = _get_client()
        if not client:
            return
        try:
            client.delete_collection(self._collection_name(task_id))
        except Exception:
            pass


vector_store = VectorStore()
