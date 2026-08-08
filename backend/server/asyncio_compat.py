import asyncio
import sys
import threading
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")


def needs_proactor_thread() -> bool:
    if sys.platform != "win32":
        return False

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False

    return not isinstance(loop, asyncio.ProactorEventLoop)


async def run_on_proactor_loop(coro_factory: Callable[[], Awaitable[T]]) -> T:
    if not needs_proactor_thread():
        return await coro_factory()

    caller_loop = asyncio.get_running_loop()
    result_future: asyncio.Future[T] = caller_loop.create_future()

    def runner() -> None:
        thread_loop = asyncio.ProactorEventLoop()
        asyncio.set_event_loop(thread_loop)

        async def invoke() -> None:
            try:
                result = await coro_factory()
            except Exception as exc:
                caller_loop.call_soon_threadsafe(result_future.set_exception, exc)
            else:
                caller_loop.call_soon_threadsafe(result_future.set_result, result)
            finally:
                thread_loop.stop()

        thread_loop.create_task(invoke())
        thread_loop.run_forever()
        thread_loop.close()

    threading.Thread(target=runner, name="windows-proactor-export", daemon=True).start()
    return await result_future