# user-feedback:reader
# Reading feedback out of a passage, shared by every function that reads one
# (bin/common.py copies it in from bin/blocks/). The questions are the shared
# contract's (_contract/questions/feedback-read.json), word for word, so User
# interviews and Early access read the same way; _contract/lint.py fails if
# this copy drifts.
from concurrent.futures import ThreadPoolExecutor as _Pool
