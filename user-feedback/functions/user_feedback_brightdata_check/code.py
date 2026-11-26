#input_type_name: UserFeedbackBrightdataCheckInput
#output_type_name: UserFeedbackBrightdataCheckResult
#function_name: user_feedback_brightdata_check

"""Is the team's Bright Data key good? Asked here, server-side, on purpose
(from the opinions pod's `check_brightdata`): a bad key makes the connector
answer 401, and in the browser the SDK would read that as the person's own
session ending. The app only ever sees this function's words.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

YOUTUBE = "gd_lk56epmy2i5g7lzu0k"


class UserFeedbackBrightdataCheckInput(BaseModel):
    account_id: str


class UserFeedbackBrightdataCheckResult(BaseModel):
    ok: bool
    reason: str = ""


def user_feedback_brightdata_check(ctx: FunctionContext, data: UserFeedbackBrightdataCheckInput) -> UserFeedbackBrightdataCheckResult:
    try:
        ctx.pod.connectors.execute("brightdata-api", "list_collections", {"dataset_id": YOUTUBE}, account_id=data.account_id)
        return UserFeedbackBrightdataCheckResult(ok=True)
    except Exception as exc:  # noqa: BLE001
        status = getattr(exc, "status_code", None)
        text = f"{getattr(exc, 'code', '')} {getattr(exc, 'message', '')} {exc}"
        if status in (401, 403) or "UNAUTHORIZED" in text or "401" in text:
            return UserFeedbackBrightdataCheckResult(ok=False, reason="Bright Data doesn't recognise this key. Copy it again from Bright Data's account settings, under API keys.")
        # Anything else (a validation complaint, a slow answer) still means the key got through.
        return UserFeedbackBrightdataCheckResult(ok=True)
