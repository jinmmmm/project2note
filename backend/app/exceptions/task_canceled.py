class TaskCanceledError(Exception):
    """任务被用户取消。Pipeline 抛出后不应覆盖 CANCELED 状态。"""
    pass
