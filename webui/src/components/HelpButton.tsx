import * as Tooltip from "@radix-ui/react-tooltip";
import { Link, useLocation } from "react-router-dom";

export function HelpButton() {
  const location = useLocation();
  const active = location.pathname === "/help";

  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            aria-label="打开系统手册"
            className="pl-help-button"
            title="系统手册"
            to="/help"
          >
            ?
          </Link>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="pl-tooltip-content" side="right" sideOffset={8}>
            系统手册
            <Tooltip.Arrow className="pl-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
