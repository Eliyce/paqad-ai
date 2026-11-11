# What paqad prints

verified: 2026-11-11

`paqad-ai hld` prints these lines itself. Show them to the developer as printed and
don't rephrase them. `<ref>` is the ticket or channel, `<age>` is how long ago the design
was posted, `<date>` is a day like 31 Oct.

| When                     | Line                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Posted and waiting       | Posted the high-level design to <ref>. The build starts once it's signed off there. You can work on something else meanwhile.                            |
| Posted for information   | Posted the high-level design to <ref> for the team to read. Carrying on with the build.                                                                  |
| Approved                 | The high-level design for <ref> was approved on <date>. Starting the build.                                                                              |
| Changes requested        | There's a reply on the high-level design for <ref> asking for changes. Here it is, so we can update the spec:                                            |
| Still waiting            | No answer on the high-level design for <ref> yet (posted <age> ago).                                                                                     |
| Not connected            | I couldn't post the high-level design: <target> isn't connected. It's in chat for you to share. Connect <target> to post it automatically next time.     |
| Waiting at a new chat    | <ref> is waiting for high-level design sign-off (posted <age> ago).                                                                                      |
| Detail missing           | The More detail part of the high-level design for <ref> didn't post. It will be added to the same thread next time; the design still waits for sign-off. |
| Move failed              | Couldn't move <ref> to "<status>". The design is posted and still waits for sign-off.                                                                    |
| Approval started over    | Updated the high-level design for <ref> to v2. Approval starts over, so earlier replies no longer count.                                                 |
| Pull request, signed off | High-level design signed off in <ref> on <date> (<link>).                                                                                                |
| Pull request, skipped    | Built before high-level design sign-off. Reason: <why>.                                                                                                  |
