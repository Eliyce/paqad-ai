def run():
    try:
        work()
    except ValueError:
        return 1
    return 0
