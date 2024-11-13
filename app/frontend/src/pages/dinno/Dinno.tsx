// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useRef, useState, useEffect } from "react";
import { Checkbox, Panel, DefaultButton, TextField, SpinButton, Separator, Toggle, Label } from "@fluentui/react";
import Switch from 'react-switch';
import { GlobeFilled, BuildingMultipleFilled, AddFilled, ChatSparkleFilled } from "@fluentui/react-icons";
import { ITag } from '@fluentui/react/lib/Pickers';

import styles from "./Dinno.module.css";
import rlbgstyles from "../../components/ResponseLengthButtonGroup/ResponseLengthButtonGroup.module.css";
import rtbgstyles from "../../components/ResponseTempButtonGroup/ResponseTempButtonGroup.module.css";

import { chatApi, Approaches, ChatResponse, ChatRequest, ChatTurn, ChatMode, getFeatureFlags, GetFeatureFlagsResponse } from "../../api";
import { Answer, AnswerError, AnswerLoading } from "../../components/Answer";
import { QuestionInput } from "../../components/QuestionInput";
import { ExampleList } from "../../components/Example";
import { UserChatMessage } from "../../components/UserChatMessage";
import { AnalysisPanel, AnalysisPanelTabs } from "../../components/AnalysisPanel";
import { SettingsButton } from "../../components/SettingsButton";
import { InfoButton } from "../../components/InfoButton";
import { ClearChatButton } from "../../components/ClearChatButton";
import { ResponseLengthButtonGroup } from "../../components/ResponseLengthButtonGroup";
import { ResponseTempButtonGroup } from "../../components/ResponseTempButtonGroup";
import { ChatModeButtonGroup } from "../../components/ChatModeButtonGroup";
import { InfoContent } from "../../components/InfoContent/InfoContent";
import { FolderPicker } from "../../components/FolderPicker";
import { TagPickerInline } from "../../components/TagPicker";
import React from "react";

const Dinno = () => {
    const [isConfigPanelOpen, setIsConfigPanelOpen] = useState(false);
    const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
    const [retrieveCount, setRetrieveCount] = useState<number>(5);
    const [useSuggestFollowupQuestions, setUseSuggestFollowupQuestions] = useState<boolean>(false);
    const [userPersona, setUserPersona] = useState<string>("analyst");
    const [systemPersona, setSystemPersona] = useState<string>("an Assistant");
    // Setting responseLength to 2048 by default, this will effect the default display of the ResponseLengthButtonGroup below.
    // It must match a valid value of one of the buttons in the ResponseLengthButtonGroup.tsx file. 
    // If you update the default value here, you must also update the default value in the onResponseLengthChange method.
    const [responseLength, setResponseLength] = useState<number>(2048);

    // Setting responseTemp to 0.6 by default, this will effect the default display of the ResponseTempButtonGroup below.
    // It must match a valid value of one of the buttons in the ResponseTempButtonGroup.tsx file.
    // If you update the default value here, you must also update the default value in the onResponseTempChange method.
    const [responseTemp, setResponseTemp] = useState<number>(0.6);

    const [activeChatMode, setChatMode] = useState<ChatMode>(ChatMode.WorkOnly);
    const [defaultApproach, setDefaultApproach] = useState<number>(Approaches.ReadRetrieveRead);
    const [activeApproach, setActiveApproach] = useState<number>(Approaches.ReadRetrieveRead);
    const [featureFlags, setFeatureFlags] = useState<GetFeatureFlagsResponse | undefined>(undefined);

    const lastQuestionRef = useRef<string>("");
    const lastQuestionWorkCitationRef = useRef<{ [key: string]: { citation: string; source_path: string; page_number: string } }>({});
    const lastQuestionWebCitiationRef = useRef<{ [key: string]: { citation: string; source_path: string; page_number: string } }>({});
    const lastQuestionThoughtChainRef = useRef<{ [key: string]: string }>({});
    const chatMessageStreamEnd = useRef<HTMLDivElement | null>(null);

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<unknown>();

    const [activeCitation, setActiveCitation] = useState<string>();
    const [activeCitationSourceFile, setActiveCitationSourceFile] = useState<string>();
    const [activeCitationSourceFilePageNumber, setActiveCitationSourceFilePageNumber] = useState<string>();
    const [activeAnalysisPanelTab, setActiveAnalysisPanelTab] = useState<AnalysisPanelTabs | undefined>(undefined);
    const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<ITag[]>([]);

    const [selectedAnswer, setSelectedAnswer] = useState<number>(0);
    const [answers, setAnswers] = useState<[user: string, response: ChatResponse][]>([]);
    const [answerStream, setAnswerStream] = useState<ReadableStream | undefined>(undefined);
    const [abortController, setAbortController] = useState<AbortController | undefined>(undefined);

    async function fetchFeatureFlags() {
        try {
            const fetchedFeatureFlags = await getFeatureFlags();
            setFeatureFlags(fetchedFeatureFlags);
        } catch (error) {
            // Handle the error here
            console.log(error);
        }
    }

    const makeApiRequest = async (question: string, approach: Approaches, 
                                work_citation_lookup: { [key: string]: { citation: string; source_path: string; page_number: string } },
                                web_citation_lookup: { [key: string]: { citation: string; source_path: string; page_number: string } },
                                thought_chain: { [key: string]: string}) => {
        lastQuestionRef.current = question;
        lastQuestionWorkCitationRef.current = work_citation_lookup;
        lastQuestionWebCitiationRef.current = web_citation_lookup;
        lastQuestionThoughtChainRef.current = thought_chain;
        setActiveApproach(approach);

        error && setError(undefined);
        setIsLoading(true);
        setActiveCitation(undefined);
        setActiveAnalysisPanelTab(undefined);

        try {
            const history: ChatTurn[] = answers.map(a => ({ user: a[0], bot: a[1].answer }));
            const request: ChatRequest = {
                history: [...history, { user: question, bot: undefined }],
                approach: approach,
                overrides: {
                    promptTemplate: undefined,
                    excludeCategory: undefined,
                    top: retrieveCount,
                    semanticRanker: true,
                    semanticCaptions: false,
                    suggestFollowupQuestions: useSuggestFollowupQuestions,
                    userPersona: userPersona,
                    systemPersona: systemPersona,
                    aiPersona: "",
                    responseLength: responseLength,
                    responseTemp: responseTemp,
                    selectedFolders: selectedFolders.includes("selectAll") ? "All" : selectedFolders.length == 0 ? "All" : selectedFolders.join(","),
                    selectedTags: selectedTags.map(tag => tag.name).join(",")
                },
                citation_lookup: approach == Approaches.CompareWebWithWork ? web_citation_lookup : approach == Approaches.CompareWorkWithWeb ? work_citation_lookup : {},
                thought_chain: thought_chain
            };

            const temp: ChatResponse = {
                answer: "",
                thoughts: "",
                data_points: [],
                approach: approach,
                thought_chain: {
                    "work_response": "",
                    "web_response": ""
                },
                work_citation_lookup: {},
                web_citation_lookup: {}
            };

            setAnswers([...answers, [question, temp]]);
            const controller = new AbortController();
            setAbortController(controller);
            const signal = controller.signal;
            const result = await chatApi(request, signal);
            if (!result.body) {
                throw Error("No response body");
            }

            setAnswerStream(result.body);
        } catch (e) {
            setError(e);
        } finally {
            setIsLoading(false);
        }
    };

    const clearChat = () => {
        lastQuestionRef.current = "";
        lastQuestionWorkCitationRef.current = {};
        lastQuestionWebCitiationRef.current = {};
        lastQuestionThoughtChainRef.current = {};
        error && setError(undefined);
        setActiveCitation(undefined);
        setActiveAnalysisPanelTab(undefined);
        setAnswers([]);
    };

    const onResponseLengthChange = (_ev: any) => {
        for (let node of _ev.target.parentNode.childNodes) {
            if (node.value == _ev.target.value) {
                switch (node.value) {
                    case "1024":
                        node.className = `${rlbgstyles.buttonleftactive}`;
                        break;
                    case "2048":
                        node.className = `${rlbgstyles.buttonmiddleactive}`;
                        break;
                    case "3072":
                        node.className = `${rlbgstyles.buttonrightactive}`;
                        break;
                    default:
                        //do nothing
                        break;
                }
            }
            else {
                switch (node.value) {
                    case "1024":
                        node.className = `${rlbgstyles.buttonleft}`;
                        break;
                    case "2048":
                        node.className = `${rlbgstyles.buttonmiddle}`;
                        break;
                    case "3072":
                        node.className = `${rlbgstyles.buttonright}`;
                        break;
                    default:
                        //do nothing
                        break;
                }
            }
        }
        // the or value here needs to match the default value assigned to responseLength above.
        setResponseLength(_ev.target.value as number || 2048)
    };

    const onResponseTempChange = (_ev: any) => {
        for (let node of _ev.target.parentNode.childNodes) {
            if (node.value == _ev.target.value) {
                switch (node.value) {
                    case "1.0":
                        node.className = `${rtbgstyles.buttonleftactive}`;
                        break;
                    case "0.6":
                        node.className = `${rtbgstyles.buttonmiddleactive}`;
                        break;
                    case "0":
                        node.className = `${rtbgstyles.buttonrightactive}`;
                        break;
                    default:
                        //do nothing
                        break;
                }
            }
            else {
                switch (node.value) {
                    case "1.0":
                        node.className = `${rtbgstyles.buttonleft}`;
                        break;
                    case "0.6":
                        node.className = `${rtbgstyles.buttonmiddle}`;
                        break;
                    case "0":
                        node.className = `${rtbgstyles.buttonright}`;
                        break;
                    default:
                        //do nothing
                        break;
                }
            }
        }
        // the or value here needs to match the default value assigned to responseLength above.
        setResponseTemp(_ev.target.value as number || 0.6)
    };

    const onChatModeChange = (_ev: any) => {
        abortController?.abort();
        const chatMode = _ev.target.value as ChatMode || ChatMode.WorkOnly;
        setChatMode(chatMode);
        if (chatMode == ChatMode.WorkOnly)
                setDefaultApproach(Approaches.ReadRetrieveRead);
                setActiveApproach(Approaches.ReadRetrieveRead);
        if (chatMode == ChatMode.WorkPlusWeb)
            if (defaultApproach == Approaches.GPTDirect) 
                setDefaultApproach(Approaches.ReadRetrieveRead)
                setActiveApproach(Approaches.ReadRetrieveRead);
        if (chatMode == ChatMode.Ungrounded)
            setDefaultApproach(Approaches.GPTDirect)
            setActiveApproach(Approaches.GPTDirect);
        clearChat();
    }

    const handleToggle = () => {
        defaultApproach == Approaches.ReadRetrieveRead ? setDefaultApproach(Approaches.ChatWebRetrieveRead) : setDefaultApproach(Approaches.ReadRetrieveRead);
    }

    useEffect(() => {fetchFeatureFlags()}, []);
    useEffect(() => chatMessageStreamEnd.current?.scrollIntoView({ behavior: "smooth" }), [isLoading]);

    const onRetrieveCountChange = (_ev?: React.SyntheticEvent<HTMLElement, Event>, newValue?: string) => {
        setRetrieveCount(parseInt(newValue || "5"));
    };

    const onUserPersonaChange = (_ev?: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        setUserPersona(newValue || "");
    }

    const onSystemPersonaChange = (_ev?: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        setSystemPersona(newValue || "");
    }

    const onUseSuggestFollowupQuestionsChange = (_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, checked?: boolean) => {
        setUseSuggestFollowupQuestions(!!checked);
    };

    const onExampleClicked = (example: string) => {
        makeApiRequest(example, defaultApproach, {}, {}, {});
    };

    const onShowCitation = (citation: string, citationSourceFile: string, citationSourceFilePageNumber: string, index: number) => {
        if (activeCitation === citation && activeAnalysisPanelTab === AnalysisPanelTabs.CitationTab && selectedAnswer === index) {
            setActiveAnalysisPanelTab(undefined);
        } else {
            setActiveCitation(citation);
            setActiveCitationSourceFile(citationSourceFile);
            setActiveCitationSourceFilePageNumber(citationSourceFilePageNumber);
            setActiveAnalysisPanelTab(AnalysisPanelTabs.CitationTab);
        }

        setSelectedAnswer(index);
    };

    const onToggleTab = (tab: AnalysisPanelTabs, index: number) => {
        if (activeAnalysisPanelTab === tab && selectedAnswer === index) {
            setActiveAnalysisPanelTab(undefined);
        } else {
            setActiveAnalysisPanelTab(tab);
        }

        setSelectedAnswer(index);
    };

    const onSelectedKeyChanged = (selectedFolders: string[]) => {
        setSelectedFolders(selectedFolders)
    };

    const onSelectedTagsChange = (selectedTags: ITag[]) => {
        setSelectedTags(selectedTags)
    }

    useEffect(() => {
        // Hide Scrollbar for this page
        document.body.classList.add('chat-overflow-hidden-body');
        // Do not apply to other pages
        return () => {
            document.body.classList.remove('chat-overflow-hidden-body');
        };
    }, []);

    const updateAnswerAtIndex = (index: number, response: ChatResponse) => {
        setAnswers(currentAnswers => {
            const updatedAnswers = [...currentAnswers];
            updatedAnswers[index] = [updatedAnswers[index][0], response];
            return updatedAnswers;
        });
    }

    const removeAnswerAtIndex = (index: number) => {
        const newItems = answers.filter((item, idx) => idx !== index);
        setAnswers(newItems);
    }

    return (
        <div className={styles.container}>
            Test Page
        </div>
    );
};

export default Dinno;
