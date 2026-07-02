from app.routers.tasks import _batch_task_title


def test_batch_task_title_includes_first_episode_number():
    assert _batch_task_title("harness-专业", 1, "") == "harness-专业 - 第1集"


def test_batch_task_title_includes_part_title_for_first_episode():
    assert _batch_task_title("harness-专业", 1, "Agent Skill 进阶介绍") == "harness-专业 - 第1集·Agent Skill 进阶介绍"


def test_batch_task_title_omits_generic_part_title():
    assert _batch_task_title("harness-专业", 2, "P2") == "harness-专业 - 第2集"
