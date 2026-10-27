def run():
    try:
        work()
    except (KeyError, IndexError):
        return 1
